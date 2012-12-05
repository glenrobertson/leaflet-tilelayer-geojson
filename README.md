# Leaflet GeoJSON Tile Layer

## Example usage
The following will set up a tile layer for an example local endpoint.

        var style = {
            "clickable": true,
            "color": "#00D",
            "fillColor": "#00D",
            "weight": 1.0,
            "opacity": 0.3,
            "fillOpacity": 0.2
        };
        var hoverStyle = {
            "fillOpacity": 0.5
        };

        var geojsonURL = 'http://localhost:8000/states/{z}/{x}/{y}.json';
        var geojsonTileLayer = new L.TileLayer.GeoJSON(geojsonURL, {
                unique: function (feature) { return feature.id; }
            }, {
                style: style,
                onEachFeature: function (feature, layer) {
                    if (feature.properties) {
                        var popupString = '<div class="popup">';
                        for (var k in feature.properties) {
                            var v = feature.properties[k];
                            popupString += k + ': ' + v + '<br />';
                        }
                        popupString += '</div>';
                        layer.bindPopup(popupString);
                    }
                    if (!(layer instanceof L.Point)) {
                        layer.on('mouseover', function () {
                            layer.setStyle(hoverStyle);
                        });
                        layer.on('mouseout', function () {
                            layer.setStyle(style);
                        });
                    }
                }
            }
        );
        map.addLayer(geojsonTileLayer);
