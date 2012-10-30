/*
    GeoJSON layer with mouse hover events to properties for each feature
    Requires JQuery to handle the AJAX requests
    Currently only supports FeatureCollections
    Features must have ID's, so they can be deduplicated across tiles (not rendered twice).
*/

/*
Control that shows HTML content for a point on hover
*/
L.Control.Hover = L.Control.extend({
    options: {
        position: "hover",
        offset: new L.Point(30,-16)
    },
    
    initialize: function(point, content, options) {
        this._point = point;
        this._content = content;
                
        L.Util.setOptions(this, options);
    },
    
    onAdd: function (map) {
        if (!map._controlCorners.hasOwnProperty("hover")) {
            map._controlCorners["hover"] = L.DomUtil.create("div", "custom-hover", map._controlContainer);
        }
        this._container = L.DomUtil.create('div', 'custom-control-hover-label');
        this._container.innerHTML = this._content;
        
        if (this.options.position == "hover" && this._point !== null) {
            this.setHoverPosition(this._point);
        }
        
        return this._container;
    },

    setHoverPosition: function (point) {
        this._container.style.top = point.y + this.options.offset.y + "px";
        this._container.style.left = point.x + this.options.offset.x + "px";
    }
});

/*
Layer of GeoJSON features in a tile area
Shows feature properties on hover
*/
L.GeoJSONTile = L.GeoJSON.extend({

    addLayer: function (layer) {
        L.GeoJSON.prototype.addLayer.call(this, layer);

        layer._parent = this;
        layer._featureDialogContent = this._getFeatureDialogContent(layer.feature);

        layer.on('mouseover', this._featureMouseOver);
        layer.on('mousemove', this._featureMouseMove);
        layer.on('mouseout', this._featureMouseOut);

        return this;
    },

    removeLayer: function (layer) {
        L.GeoJSON.prototype.removeLayer.call(this, layer);

        if (layer._featureDialogControl) {
            layer._parent._map.removeControl(layer._featureDialogControl);
        }
        layer._parent = null;

        layer.off('mouseover', this._featureMouseOver);
        layer.off('mousemove', this._featureMouseMove);
        layer.off('mouseout', this._featureMouseOut);
        
        return this;
    },
    
    onRemove: function (map) {
        this.eachLayer(this.removeLayer, this);
    },

    _createFeatureDialogControl: function(hoverPoint, dialogContent) {
        return new L.Control.Hover(hoverPoint, dialogContent, {
            'offset': this.options.hoverOffset
        });
    },

    _featureMouseOver: function (evt) {
        var tile = this._parent;
        var hoverPoint = tile._map.mouseEventToContainerPoint(evt.originalEvent);

        if (!this._featureDialogControl) {
            this._featureDialogControl = tile._createFeatureDialogControl(hoverPoint, this._featureDialogContent);
            tile._map.addControl(this._featureDialogControl);
        }
        
        if (this.setStyle !== undefined) {
            // Set layer to hover style so we can see the hovered feature
            this.setStyle(tile.options.hoverStyle);
        }
    },

    _featureMouseMove: function (evt) {
        var tile = this._parent;
        // Move current hover control to mouse pointer
        var hoverPoint = tile._map.mouseEventToContainerPoint(evt.originalEvent);
        this._featureDialogControl.setHoverPosition(hoverPoint);
    },

    _featureMouseOut: function (evt) {
        var tile = this._parent;
        if (this._featureDialogControl) {
            tile._map.removeControl(this._featureDialogControl);
            this._featureDialogControl = null;
        }

        if (this.setStyle !== undefined) {
            // Revert to original style
            this.setStyle(tile.options.style);
        }
    },

    _getFeatureDialogContent: function (feature) {
        var hoverContent = '<div class="geojson-dialog-hover">';
        
        // heading
        if (this.options.hoverHeadingProperty && this.options.hoverHeadingProperty in feature.properties) {
            var heading = feature.properties[this.options.hoverHeadingProperty];
            hoverContent += '<p class="geojson-feature-heading">'+heading+'</p>';
        } 
       
        for(var key in feature.properties) {
            if (key === this.options.hoverHeadingProperty) {
                continue;
            }
            var value = feature.properties[key];
            hoverContent += '<p class="geojson-feature-property">';
            hoverContent += '<span class="geojson-feature-property-name">' + key + '</span>';
            hoverContent += '<span class="geojson-feature-property-value">' + value + '</span>';
            hoverContent += '</p>';
        }
        hoverContent += '</div>';
        return hoverContent;
    }

});


/*
    TileLayer that retrieves and shows GeoJSON tiles, with an {Z}/{X}/{Y} style URL.
    Each tile is a GeoJSONHover layer (set of feature layers)
    Features are deduplicated across tiles by their id.
    Currently assumes a FeatureCollection
*/
L.TileLayer.GeoJSON = L.TileLayer.extend({
    includes: L.Mixin.Events,

    options: {
        minZoom: 0,
        maxZoom: 18,
        tileSize: 256,
        subdomains: 'abc',
        errorTileUrl: '',
        attribution: '',
        zoomOffset: 0,
        opacity: 1,

        zIndex: null,
        tms: false,
        continuousWorld: false,
        noWrap: false,
        zoomReverse: false,
        detectRetina: false,
        
        updateWhenIdle: L.Browser.mobile
    },

    geoJSONOptions: {
        /* style of GeoJSON feature */
        style: {
            "color": "#00D",
            "fillColor": "#00D",
            "weight": 1.0,
            "opacity": 0.5,
            "fillOpacity": 0.1
        },
        /* style of GeoJSON feature when hovered */
        hoverStyle: {
            "opacity": 0.5,
            "fillOpacity": 0.3
        },
        hoverOffset: new L.Point(15,-15),
        hoverHeadingProperty: 'name'
    },

    initialize: function (url, options) {
        L.Util.setOptions(this, options);

        // detecting retina displays, adjusting tileSize and zoom levels
        if (this.options.detectRetina && L.Browser.retina && this.options.maxZoom > 0) {

            this.options.tileSize = Math.floor(this.options.tileSize / 2);
            this.options.zoomOffset++;

            if (this.options.minZoom > 0) {
                this.options.minZoom--;
            }
            this.options.maxZoom--;
        }

        this._url = url;

        var subdomains = this.options.subdomains;

        if (typeof subdomains === 'string') {
            this.options.subdomains = subdomains.split('');
        }
    },

    onAdd: function (map) {
        this._map = map;

        // set up events
        map.on({
            'viewreset': this._resetCallback,
            'moveend': this._update
        }, this);

        if (!this.options.updateWhenIdle) {
            this._limitedUpdate = L.Util.limitExecByInterval(this._update, 150, this);
            map.on('move', this._limitedUpdate, this);
        }

        this._reset();
        this._update();
    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    onRemove: function (map) {
        map.off({
            'viewreset': this._resetCallback,
            'moveend': this._update
        }, this);

        if (!this.options.updateWhenIdle) {
            map.off('move', this._limitedUpdate, this);
        }
        this._reset();
        this._map = null;
    },

    setGeoJSONOptions: function(options) {
        this.geoJSONOptions = L.Util.extend({}, this.geoJSONOptions, options);
    },

    _resetCallback: function (e) {
        this._reset(e.hard);
    },

    // viewreset event triggered (e.g. zoom changed)
    // remove all tiles from previous zoom level
    _reset: function (clearOldContainer) {
        var key,
            tiles = this._tiles;

        for (key in tiles) {
            if (tiles.hasOwnProperty(key)) {
                this.fire('tileunload', {tile: tiles[key]});
                this._removeTile(key);
            }
        }

        this._tiles = {};
        this._tilesToLoad = 0;

        // geojson features by id
        // used to deduplicate features across adjacent tiles
        this._geoJSONFeatures = {};

    },

    // moveend event triggered (e.g. map panned)
    // add any new tiles required
    _update: function (e) {
        if (this._map._panTransition && this._map._panTransition._inProgress) { return; }

        var bounds   = this._map.getPixelBounds(),
            zoom     = this._map.getZoom(),
            tileSize = this.options.tileSize;

        if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
            return;
        }

        var nwTilePoint = new L.Point(
                Math.floor(bounds.min.x / tileSize),
                Math.floor(bounds.min.y / tileSize)),
            seTilePoint = new L.Point(
                Math.floor(bounds.max.x / tileSize),
                Math.floor(bounds.max.y / tileSize)),
            tileBounds = new L.Bounds(nwTilePoint, seTilePoint);

        this._addTilesFromCenterOut(tileBounds);
    },

    _addTilesFromCenterOut: function (bounds) {
        var queue = [],
            center = bounds.getCenter();

        var j, i, point;

        for (j = bounds.min.y; j <= bounds.max.y; j++) {
            for (i = bounds.min.x; i <= bounds.max.x; i++) {
                point = new L.Point(i, j);

                if (this._tileShouldBeLoaded(point)) {
                    queue.push(point);
                }
            }
        }

        var tilesToLoad = queue.length;

        if (tilesToLoad === 0) { return; }

        // load tiles in order of their distance to center
        queue.sort(function (a, b) {
            return a.distanceTo(center) - b.distanceTo(center);
        });

        // if its the first batch of tiles to load
        if (!this._tilesToLoad) {
            this.fire('loading');
        }

        this._tilesToLoad += tilesToLoad;

        for (i = 0; i < tilesToLoad; i++) {
            this._addTile(queue[i]);
        }

    },

    _tileShouldBeLoaded: function (tilePoint) {
        if ((tilePoint.x + ':' + tilePoint.y) in this._tiles) {
            return false; // already loaded
        }

        if (!this.options.continuousWorld) {
            var limit = this._getWrapTileNum();

            if (this.options.noWrap && (tilePoint.x < 0 || tilePoint.x >= limit) ||
                                        tilePoint.y < 0 || tilePoint.y >= limit) {
                return false; // exceeds world bounds
            }
        }
        return true;
    },

    _removeOtherTiles: function (bounds) {
        var kArr, x, y, key;

        for (key in this._tiles) {
            if (this._tiles.hasOwnProperty(key)) {
                kArr = key.split(':');
                x = parseInt(kArr[0], 10);
                y = parseInt(kArr[1], 10);

                // remove tile if it's out of bounds
                if (x < bounds.min.x || x > bounds.max.x || y < bounds.min.y || y > bounds.max.y) {
                    this._removeTile(key);
                }
            }
        }
    },

    _removeTile: function (key) {
        var tile = this._tiles[key];

        this.fire("tileunload", {tile: tile, url: tile._url});

        if (!L.Browser.android) { //For https://github.com/CloudMade/Leaflet/issues/137
            tile._url = L.Util.emptyImageUrl;
        }

        delete this._tiles[key];
        this._map.removeLayer(tile);
    },

    _addTile: function (tilePoint) {
        var tilePos = this._getTilePos(tilePoint);

        // get unused tile - or create a new tile
        var tile = this._getTile();
        tile._url = this.getTileUrl(tilePoint);

        this._tiles[tilePoint.x + ':' + tilePoint.y] = tile;

        this._loadTile(tile, tilePoint);

        this._map.addLayer(tile);
    },

    _getZoomForUrl: function () {
        var options = this.options,
            zoom = this._map.getZoom();

        if (options.zoomReverse) {
            zoom = options.maxZoom - zoom;
        }

        return zoom + options.zoomOffset;
    },

    _getTilePos: function (tilePoint) {
        var origin = this._map.getPixelOrigin(),
            tileSize = this.options.tileSize;

        return tilePoint.multiplyBy(tileSize).subtract(origin);
    },

    getTileUrl: function (tilePoint) {
        this._adjustTilePoint(tilePoint);

        return L.Util.template(this._url, L.Util.extend({
            s: this._getSubdomain(tilePoint),
            z: this._getZoomForUrl(),
            x: tilePoint.x,
            y: tilePoint.y
        }, this.options));
    },

    _getWrapTileNum: function () {
        // TODO refactor, limit is not valid for non-standard projections
        return Math.pow(2, this._getZoomForUrl());
    },

    _adjustTilePoint: function (tilePoint) {

        var limit = this._getWrapTileNum();

        // wrap tile coordinates
        if (!this.options.continuousWorld && !this.options.noWrap) {
            tilePoint.x = ((tilePoint.x % limit) + limit) % limit;
        }

        if (this.options.tms) {
            tilePoint.y = limit - tilePoint.y - 1;
        }
    },

    _getSubdomain: function (tilePoint) {
        var index = (tilePoint.x + tilePoint.y) % this.options.subdomains.length;
        return this.options.subdomains[index];
    },

    _createTile: function() {
        return new L.GeoJSONTile(null, this.geoJSONOptions);
    },

    _getTile: function () {
        return this._createTile();
    },

    _resetTile: function (tile) {
        // Override if data stored on a tile needs to be cleaned up before reuse
    },

    /* 
    Get the tile URL and load it's GeoJSON
    The GeoJSON is loaded using JQuery, 
    and the response is assumed to be a FeatureCollection
    Dedupe any features that have been loaded from other adjacent tiles
    */
    _loadTile: function (tile, tilePoint) {
        tile._layer = this;

        var url = tile._url;

        $.ajax({
            url: url, 
            dataType: 'json',

            success: function(data) {
                // convert each feature of the geojson object to a layer
                // put the layer in the internal feature group

                for(var f in data.features) {

                    var feature = data.features[f];
                    // dedupe features that are already in the layer 
                    // from already loaded adjacent tiles
                    if(feature.id in tile._layer._geoJSONFeatures) {
                        continue;
                    }
                    tile.addData(feature);
                    tile._layer._geoJSONFeatures[feature.id] = feature;
                }

                tile._layer._tileOnLoad.call(tile);
            },
            error: function() {
                tile._layer._tileOnError.call(tile);
            }
        });
    },

    _tileLoaded: function () {
        this._tilesToLoad--;
        if (!this._tilesToLoad) {
            this.fire('load');
        }
    },

    _tileOnLoad: function () {
        var layer = this._layer;
        layer._tileLoaded();
    },

    _tileOnError: function () {
        var tile = this;
        var layer = tile._layer;

        layer.fire('tileerror', {
            tile: this,
            url: this._url
        });

        var newUrl = layer.options.errorTileUrl;
        if (newUrl) {
            this._url = newUrl;
        }

        layer._tileLoaded();
    }

});