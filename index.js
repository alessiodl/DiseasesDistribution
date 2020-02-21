import 'ol/ol.css';
// import 'ol-ext/dist/ol-ext.min.css';
import Map from 'ol/Map';
import View from 'ol/View';
import {fromLonLat, transform} from 'ol/proj';
import GeoJSON from 'ol/format/GeoJSON';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import VectorImageLayer from 'ol/layer/VectorImage';
import {Fill, Stroke, Style, Text, Image, Circle} from 'ol/style';
import Chart from 'ol-ext/style/Chart';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import axios from 'axios';
import lodash from 'lodash'
import { Feature } from 'ol';

// Style functions
// ***********************************

var getChartData = function(feature){
  var tot = feature.get('tot');
  // Calcola percentuali per la torta
  var hum, ani, vir, unk;
  if (feature.get('tot') > 0){
    if (feature.get('human') > 0){
      hum = parseInt((feature.get('human')*100)/tot);
    } else {
      hum = 0;
    }
    if (feature.get('animals') > 0){
      ani = parseInt((feature.get('animals')*100)/tot);
    } else {
      ani = 0;
    }
    if (feature.get('virus') > 0){
      vir = parseInt((feature.get('virus')*100)/tot);
    } else {
      vir = 0;
    }
    if (feature.get('unknown') > 0){
      unk = parseInt((feature.get('unknown')*100)/tot);
    } else {
      unk = 0;
    }
  }
  // console.log(hum+","+ani+","+vir+","+unk)
  return [hum,ani,vir,unk];
};

// Layers
// ***************************************
var map = new Map({
  layers: [
    new TileLayer({
      source: new OSM()
    })
  ],
  target: 'map',
  view: new View({
    center: fromLonLat([14, 42]),
    constrainResolution: true,
    zoom: 5,
    minZoom: 3,
    maxZoom: 18
  })
});

// map.addLayer(adminLayer);

var adminUnitsLayer = new VectorImageLayer({
  imageRatio: 2,
  source: new VectorSource({
    format: new GeoJSON()
  }),
  style: new Style({
    fill: new Fill({
      color: 'rgba(255,0,0,0.5)'
    }),
    stroke: new Stroke({
      color: '#FFF',
      width: 0.5
    })
  })
});
map.addLayer(adminUnitsLayer);

var diseaseCentroidsLayer = new VectorImageLayer({
  imageRatio: 2,
  source: new VectorSource({
    format: new GeoJSON()
  }),
  style: function(feature) {
    return new Style({
      image: new Chart({
        type: "donut",
        radius: "15", 
        colors: ['#2196f3','#d32f2f','#388e3c','#9e9e9e'],
        data: getChartData(feature), 
        rotateWithView: true,
        stroke: new Stroke({color: '#eceff1', width: 1})
      })
    });
  }
});

map.addLayer(diseaseCentroidsLayer);
// diseaseCentroidsLayer.setVisible(false)
// console.log(diseaseCentroidsLayer.getSource().getFeatures());
const extractDistributionData = function(){

  // Parametri
  let disease = document.querySelector('#disease').value;
  let country = document.querySelector('#country').value;
  let refYear = document.querySelector('#year').value;

  axios.get('https://webgis.izs.it/arcgis/rest/services/NetMed/NETMED/MapServer/2/query',{
    params:{
        where: " DISEASE_DESC = '"+disease+"' AND COUNTRY_N IN('"+country+"') AND YEAR_REF_START = '"+refYear+"' AND YEAR_REF_END = '"+refYear+"' ",
        returnGeometry: false,
        outFields: 'GEO_ID,FLAG_DISEASE,LATITUDE,LONGITUDE',
        f: 'geojson'
    }
  }).then(function(response){
    // console.log(response.data.features);
    var distribution_data = response.data.features;
    var data = [];
    distribution_data.forEach(element => {
      var geoid = element.properties.GEO_ID;
      var flag  = element.properties.FLAG_DISEASE;
      var lat   = element.properties.LATITUDE;
      var lng   = element.properties.LONGITUDE;
      data.push( { "geoid" : geoid, "flag": flag, "lng": lng.toFixed(3), "lat": lat.toFixed(3) } );
    });

    var grouped_data = [];
    grouped_data = lodash.groupBy(data,"geoid");
    // console.log(grouped_data);

    var centroids = [];
    var unique_geoids = [];
    lodash.forEach(grouped_data,function(item, key){

      var num_u  = lodash.filter(item, function(el) { return el.flag == "U"; }).length;
      var num_c  = lodash.filter(item, function(el) { return el.flag == "C"; }).length;
      var num_v  = lodash.filter(item, function(el) { return el.flag == "V"; }).length;
      var num_un = lodash.filter(item, function(el) { return el.flag == null; }).length;
      var num_tot = num_u + num_c + num_v + num_un;

      var feature = {
        "type":"Feature",
        "geometry":{
          "type": "Point", 
          "coordinates": new transform([ 
            parseFloat(item[0].lng), 
            parseFloat(item[0].lat) 
          ],'EPSG:4326','EPSG:3857')
        },
        "properties":{
          "geoid": key, 
          "human": num_u,
          "animals": num_c,
          "viral": num_v,
          "unknown": num_un,
          "tot": num_tot
        }
      };
      // console.log(feature);
      centroids.push(feature);
      unique_geoids.push(key);
    });
    // console.log(centroids)
    // console.log(unique_geoids)

    // Popola il layer dei centroidi di distribuzione
    var collection = {"type": "FeatureCollection", "features": centroids};
    var featureCollection = new GeoJSON().readFeatures(collection);
    diseaseCentroidsLayer.getSource().addFeatures(featureCollection);
    // Popola il layer dei poligoni delle unità amministrative in base ai geoid dei centroidi
    populateAdminUnitsLayer(unique_geoids)
  });
}

const populateAdminUnitsLayer = function(unique_geoids){
  axios.get('https://webgis.izs.it/arcgis/rest/services/NetMed/NETMED/MapServer/3/query',{
  params:{
      where: "GEO_ID IN ('"+unique_geoids.join("','")+"')",
      returnGeometry: true,
      outSR:'3857',
      outFields: 'GEO_ID',
      f: 'geojson'
  }
  }).then(function(response){
    // console.log(response.data.features);
    var collection = {"type": "FeatureCollection", "features": response.data.features};
    var featureCollection = new GeoJSON().readFeatures(collection);
    adminUnitsLayer.getSource().addFeatures(featureCollection);
  })
};

const clearLayers = function(){
  diseaseCentroidsLayer.getSource().clear();
  adminUnitsLayer.getSource().clear();
}

map.on('moveend', function(){
  console.log( "zoom corrente:",map.getView().getZoom() )
  if (map.getView().getZoom() >= 10) {
    // diseaseCentroidsLayer.setVisible(true);
  } else {
    // diseaseCentroidsLayer.setVisible(false);
  }
});

map.once('postrender', function(){
  extractDistributionData()
});

const selectDisease = document.querySelector('#disease');
selectDisease.addEventListener('change', (event) => {
  clearLayers();
  extractDistributionData();
});

const selectCountry = document.querySelector('#country');
selectCountry.addEventListener('change', (event) => {
  clearLayers();
  extractDistributionData()
});

const selectRefYear = document.querySelector('#year');
selectRefYear.addEventListener('change', (event) => {
  clearLayers();
  extractDistributionData()
});

/*

1) Effettuare il filtro sul layer della distribuzione utilizzando tutte le chiavi opportune (periodo di tempo, specie, ecc...)
2) Per ogni record del risultato considerare il GEO_ID (che sarà ripetuto N volte) e sommare il numero di occorrenze dei flag (U,C,V,Null) per ogni GEO_ID ripetuto.
3) Costruire un layer da tematizzare con grafico a torta con la struttura seguente:

|GEO_ID|GEOMETRY|Count U|Count C|Count V|Count Null|
|------|--------|-------|-------|-------|----------|
|xxxx01|-latlng-|--23---|---1---|---9---|-----0----|
|------|--------|-------|-------|-------|----------|
|------|--------|-------|-------|-------|----------|
...
...

*/
