// Load data tiles using the JQuery ajax function
L.TileLayer.Ajax = L.TileLayer.extend({
    _requests: [],
    _data: [],
    isLoading: false,
    onAdd: function (map) {
        this.on('loading', this._tilesLoading);
        this.on('load', this._tilesLoaded);
        L.TileLayer.prototype.onAdd.call(this, map);
    },
    onRemove: function (map) {
        L.TileLayer.prototype.onRemove.call(this, map);
        this.off('loading', this._tilesLoading);
        this.off('load', this._tilesLoaded);
    },
    data: function () {
        if (this.isLoading) return null;
        for (t in this._tiles) {
            var tile = this._tiles[t];
            if (!tile.processed) {
                this._data = this._data.concat(tile.datum);
                tile.processed = true;
            }
        }
        return this._data;
    },
    _addTile: function(tilePoint, container) {
        var tile = { datum: null, processed: false };
        this._tiles[tilePoint.x + ':' + tilePoint.y] = tile;
        this._loadTile(tile, tilePoint);
    },
    _loadTile: function (tile, tilePoint) {
        var layer = this;
        this._requests.push($.ajax({
            url: this.getTileUrl(tilePoint),
            dataType: 'json',
            success: function(datum) {
                tile.datum = datum;
                layer._tileLoaded();
            },
            error: function() {
                layer._tileLoaded();
            }
        }));
    },
    _tilesLoading: function () {
        this.isLoading = true;
    },
    _tilesLoaded: function () {
        this._requests = [];
        this.isLoading = false;
    },
    _resetCallback: function() {
        L.TileLayer.prototype._resetCallback.apply(this, arguments);
        for (i in this._requests) {
            this._requests[i].abort(); 
        }
        this._data = [];
        this._requests = [];
    },
    _update: function() {
        if (this._map._panTransition && this._map._panTransition._inProgress) { return; }
        if (this._tilesToLoad < 0) this._tilesToLoad = 0;
        L.TileLayer.prototype._update.apply(this, arguments);
    }
});

// Load tiled GeoJSON and merge into single geojson hash.
// Multiple features can be grouped by specifying a featureMergeKey function in the options
// Geometry tile boundaries will be dissolved only if the boundary lines are equal but opposing direction for adjacent tiles
L.TileLayer.GeoJSON = L.TileLayer.Ajax.extend({
    _geojson: {"type":"FeatureCollection","features":[]},
    initialize: function (url, options, geojsonOptions) {
        L.TileLayer.Ajax.prototype.initialize.call(this, url, options);
        this.geojsonLayer = new L.GeoJSON(this._geojson, geojsonOptions);
        this.geojsonOptions = geojsonOptions;
    },
    onAdd: function (map) {
        this._map = map;
        L.TileLayer.Ajax.prototype.onAdd.call(this, map);
        map.addLayer(this.geojsonLayer);
    },
    onRemove: function (map) {
        map.removeLayer(this.geojsonLayer);
        L.TileLayer.Ajax.prototype.onRemove.call(this, map);
    },
    groupByKey: function (items, keyCallback) {
        var groups = {};
        for (i in items) {
            var item = items[i];
            var key = keyCallback(item);
            if (!groups.hasOwnProperty(key)) {
                groups[key] = [];
            }
            groups[key].push(item);
        }
        return groups;
    },
    data: function () {
        var tileData = L.TileLayer.Ajax.prototype.data.call(this);
        if (tileData === null) return null;
        this._geojson.features = [];

        for (var t in tileData) {
            var tileDatum = tileData[t];
            if (tileDatum && tileDatum.features) {
                this._geojson.features =
                    this._geojson.features.concat(tileDatum.features);
            }
            // add any other properties from the featurecollection to the geojson object
            var tileNoFeatures = L.Util.extend({}, tileDatum);
            delete tileNoFeatures.features;
            this._geojson = L.Util.extend(this._geojson, tileNoFeatures);
        }
        // group features by string from merge key function
        if (this.options.unique) {
            var features = this.groupByKey(this._geojson.features, this.options.unique);
            this._geojson.features = [];
            for (var k in features) {
                var featureParts = features[k];
                var feature = this.union(featureParts);
                delete features[k];
                this._geojson.features.push(feature);
            }
        }
        return this._geojson;
    },
    _resetCallback: function () {
        L.TileLayer.Ajax.prototype._resetCallback.apply(this, arguments);
        this._geojson.features = [];
    },
    _tilesLoaded: function () {
        L.TileLayer.Ajax.prototype._tilesLoaded.apply(this, arguments);
        this.geojsonLayer.clearLayers().addData(this.data());
        this.fire('loaded');        
    },
    coordinateString: function (coordinate) {
        return coordinate.join(',');
    },
    stringCoordinate: function (str) {
        var coordinate = str.split(',');
        return [parseFloat(coordinate[0]), parseFloat(coordinate[1])];
    },
    extendLines: function (lines, newLines) {
        for (var s in newLines) {
            if (!lines.hasOwnProperty(s)) lines[s] = {};
            for (var e in newLines[s]) {
                lines[s][e] = true;    
            }
        }
        return lines;
    },
    // returns line segments and points
    geometryToLines: function (geometry) {
        var lines = {};
        switch (geometry.type) {
            case 'Point':
                var s = this.coordinateString(geometry.coordinates);
                if (!lines.hasOwnProperty(s)) lines[s] = {};
                lines[s]['null'] = true;
                break;
            case 'LineString':
                for (var p = 0; p < geometry.coordinates.length - 1; p++) {
                    var s = this.coordinateString(geometry.coordinates[p]);
                    var e = this.coordinateString(geometry.coordinates[p + 1]);
                    if (!lines.hasOwnProperty(s)) lines[s] = {};
                    lines[s][e] = true;
                }
                break;
            case 'Polygon':
                for (var lr = 0; lr < geometry.coordinates.length; lr++) {
                    // TODO: deal with holes
                    if (lr === 0) {
                        lines = this.extendLines(lines, this.geometryToLines({
                            'type': 'LineString',
                            'coordinates': geometry.coordinates[lr]
                        }));
                    }
                }
                break;
            case 'MultiPoint':
            case 'MultiLineString':
            case 'MultiPolygon':
                for (var p = 0; p < geometry.coordinates.length; p++) {
                    lines = this.extendLines(lines, this.geometryToLines({
                        'type': geometry.type.replace('Multi', ''),
                        'coordinates': geometry.coordinates[p]
                    }));
                }
                break;
            case 'GeometryCollection':
                for (var g in geometry.geometries) {
                    lines = this.extendLines(lines, 
                        this.geometryToLines(geometry.geometries[g]));
                }
                break;
        }
        return lines;
    },
    // merge all line segments into a single geometry
    linesToGeometry: function (lines) {
        var points = [];
        var lineStrings = [];
        var polygons = [];

        // find points, linestrings and polygons from the set of line segments
        for (var s in lines) {
            if (lines[s].hasOwnProperty('null')) {
                points.push({
                    type: 'Point',
                    coordinates: this.stringCoordinate(s)
                });
            }
            else {
                // walk the line string
                var coordinates = [];
                while (lines.hasOwnProperty(s)) {
                    var e = Object.keys(lines[s])[0];
                    coordinates.push(this.stringCoordinate(s));
                    delete lines[s][e];
                    if (Object.keys(lines[s]).length === 0) delete lines[s];
                    s = e;
                }
                if (e === this.coordinateString(coordinates[0])) {
                    coordinates.push(coordinates[0]);
                    polygons.push({
                        type: 'Polygon',
                        coordinates: [coordinates]
                    });
                }
                else {
                    lineStrings.push({
                        type: 'LineString',
                        coordinates: coordinates
                    });
                }
            }
        }
        // construct the set of points, linestrings and geometries into a feature
        var feature = {};
        if ((points.length > 0 && lineStrings.length > 0) ||
                (points.length > 0 && polygons.length > 0) ||
                (lineStrings.length > 0 && polygons.length > 0)) {
            feature = {
                type: 'GeometryCollection',
                geometries: []
                    .concat(points)
                    .concat(lineStrings)
                    .concat(polygons)
            };
        }
        else if (points.length === 1) {
            feature = points[0];
        }
        else if(points.length > 1) {
            feature = {
                type: 'MultiPoint',
                coordinates: []
            };
            for (var p = 0; p < points.length; p++) {
                feature.coordinates.push(points[p].coordinates);
            }
        }
        else if (lineStrings.length === 1) {
            feature = lineStrings[0];
        }
        else if (lineStrings.length > 1) {
            feature = {
                type: 'MultiLineString',
                coordinates: []
            };
            for (var l = 0; l < lineStrings.length; l++) {
                feature.coordinates.push(lineStrings[l].coordinates);
            }
        }
        else if (polygons.length === 1) {
            feature = polygons[0];
        }
        else if (polygons.length > 1) {
            feature = {
                type: 'MultiPolygon',
                coordinates: []
            };
            for (var p = 0; p < polygons.length; p++) {
                feature.coordinates.push(polygons[p].coordinates);
            }
        }
        return feature;
    },
    union: function (features) {
        // collect points and line segments from each feature
        // remove equal and opposite line segments (tile boundary lines)
        var lines = {};
        for (var f in features) {
            var lineSet = this.geometryToLines(features[f].geometry);
            for (var s in lineSet) {
                for (var e in lineSet[s]) {
                    if (lines.hasOwnProperty(e) && lines[e][s]) {
                        delete lines[e][s];
                        if (Object.keys(lines[e]).length === 0) delete lines[e];
                    }
                    else {
                        if (!lines.hasOwnProperty(s)) lines[s] = {};
                        lines[s][e] = lineSet[s][e];
                    }
                }
            }
        }
        return {
            'id': features[0].id,
            'type': 'Feature',
            'geometry': this.linesToGeometry(lines),
            'properties': features[0].properties
        };
    }
});