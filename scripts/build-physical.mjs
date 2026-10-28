// Builds physical-geography targets (rivers, lakes, mountains) from OpenStreetMap.
//
//   npm run build:physical            -> every map in PHYSICAL
//   npm run build:physical -- serbia  -> one map
//
// Raw Overpass responses are cached in .cache/ (git-ignored). Output goes to
// src/maps/<id>/physical.json (lon/lat; simplified).

import fs from 'node:fs/promises';
import path from 'node:path';
import mapshaper from 'mapshaper';
import { PROVINCES, SERBIA_REGIONS, GERMANY_REGIONS } from './provinces.mjs';
import { toCyrillic, finnishToSerbian } from './serbian.mjs';

/** Province maps: rivers with less than this inside the province are not asked. */
const MIN_PROVINCE_RIVER_KM = 8;
/** Region maps: a peak just outside the region is moved this far inside it. */
const MOUNTAIN_INSIDE_KM = 4;

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
// Public Overpass instances, tried in order (the main one is often busy).
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// `level` is the game level from which the feature can be asked (1 = best known).
// Rivers: 'Name', ['Name', [minLon, minLat, maxLon, maxLat]] to keep only the parts in that
// box (for names shared by several rivers), or { name, osm: [OSM names], box? } when the shown
// river is made of differently named OSM rivers (e.g. Rijn = Bovenrijn + Nederrijn). Add
// `canals: true` when stretches of the river are tagged as canal in OSM, and `type: 'canal'`
// for canals (shown as "canal" in the game).
// Water areas (`waterAreas`): large waters played like lakes (fly over them), from an OSM
// relation and/or a rough outline; the land is cut out, so the shape follows the real coast and
// islands become holes (`inland: true`: only the lake's own islands, for a lake on Natural Earth
// land). `type: 'water'` for seas/estuaries ("water" in the game). Lakes: 'Name' or ['Shown name', 'OSM name']. Mountains: ['Range', 'OSM peak name'] or
// ['Range', { lat, lon, ele }] where OSM has no usable peak tag (coordinates taken from OSM
// nodes for that summit/range).
const PHYSICAL = {
  serbia: {
    areas: ['RS', 'XK'],
    bbox: [18.1, 41.5, 23.6, 46.55],
    rivers: {
      1: ['Dunav', 'Sava', 'Tisa', 'Drina', 'Velika Morava', 'Zapadna Morava', 'Južna Morava', 'Ibar'],
      2: ['Timok', 'Nišava', 'Tamiš', 'Begej', 'Kolubara', 'Lim'],
      3: ['Mlava', 'Pek', ['Toplica', [20.8, 42.9, 22.0, 43.5]], 'Pčinja', 'Rasina', 'Uvac', 'Jadar', 'Studenica', 'Sitnica', 'Beli Drim'],
    },
    lakes: {
      1: ['Đerdapsko jezero', 'Vlasinsko jezero', 'Palićko jezero', 'Srebrno jezero'],
      2: [['Perućac', 'Jezero Perućac'], 'Zlatarsko jezero', ['Gazivode', 'Jezero Gazivode'], 'Uvačko jezero', 'Borsko jezero'],
      3: ['Bovansko jezero', 'Garaško jezero', 'Zaovinsko jezero', 'Gružansko jezero', 'Ludaško jezero', 'Savsko jezero'],
    },
    mountains: {
      1: [['Kopaonik', 'Pančićev vrh'], ['Zlatibor', { lat: 43.654, lon: 19.64, ele: 1496 }], ['Fruška gora', { lat: 45.157, lon: 19.709, ele: 540 }], ['Tara', 'Zborište'], ['Stara planina', { lat: 43.395, lon: 22.678, ele: 2169 }]],
      2: [['Rtanj', 'Šiljak'], ['Suva planina', 'Trem'], ['Golija', 'Jankov kamen'], ['Avala', 'Avala'], ['Rudnik', 'Cvijićev vrh'], ['Šar planina', 'Ljuboten'], ['Prokletije', 'Đeravica'], ['Besna Kobila', 'Besna Kobila']],
      3: [['Maljen', 'Kraljev sto'], ['Povlen', 'Mali Povlen'], ['Jastrebac', 'Velika Đulica'], ['Radan', 'Šopot'], ['Zlatar', 'Golo brdo'], ['Goč', 'Krnja jela'], ['Kosmaj', 'Kosmaj'], ['Cer', { lat: 44.606, lon: 19.488, ele: 687 }], ['Ozren', 'Leskovik'], ['Vidlič', { lat: 43.137, lon: 22.819, ele: null }], ['Ovčar', 'Ovčar'], ['Kablar', 'Kablar']],
    },
    // "Find them all": the level 1 and 2 waters and mountains (with 64 places in cities.json: 100 names).
    core: ['Dunav', 'Sava', 'Tisa', 'Drina', 'Velika Morava', 'Zapadna Morava', 'Južna Morava', 'Ibar', 'Timok', 'Nišava', 'Tamiš', 'Begej', 'Kolubara', 'Lim',
      'Đerdapsko jezero', 'Vlasinsko jezero', 'Palićko jezero', 'Srebrno jezero', 'Perućac', 'Zlatarsko jezero', 'Gazivode', 'Uvačko jezero', 'Borsko jezero',
      'Kopaonik', 'Zlatibor', 'Fruška gora', 'Tara', 'Stara planina', 'Rtanj', 'Suva planina', 'Golija', 'Avala', 'Rudnik', 'Šar planina', 'Prokletije', 'Besna Kobila'],
  },
  germany: {
    areas: ['DE'],
    // OSM names in Germany are German: no need to search other name tags.
    nameKeys: ['name'],
    bbox: [5.6, 47.1, 15.2, 55.1],
    rivers: {
      1: [
        // Border stretches carry both names in OSM.
        { name: 'Rhein', osm: ['Rhein', 'Rhein / Rhin', 'Rhin / Rhein'] },
        'Elbe', 'Donau', 'Weser',
        // The border river is named in Polish (Odra) in OSM; not the Oder in the Harz.
        { name: 'Oder', osm: ['Oder', 'Odra', 'Oder / Odra', 'Odra / Oder'], box: [13.5, 51.0, 15.2, 54.0] },
      ],
      2: [
        { name: 'Mosel', osm: ['Mosel', 'Mosel / Moselle', 'Moselle / Mosel', 'Mosel / Musel', 'Musel / Mosel'] },
        // Not the small Ems in Hessen.
        ['Ems', [6.9, 51.7, 8.7, 53.6]],
        'Main', 'Neckar', 'Ruhr', 'Isar', 'Inn', 'Saale', 'Spree', 'Havel',
        { name: 'Nord-Ostsee-Kanal', type: 'canal', canals: true },
        { name: 'Mittellandkanal', type: 'canal', canals: true },
      ],
      // No Fulda: also a city.
      3: [
        'Lahn', 'Werra', 'Lech', 'Aller', 'Leine', 'Mulde', 'Saar', 'Lippe',
        { name: 'Main-Donau-Kanal', type: 'canal', canals: true },
        { name: 'Dortmund-Ems-Kanal', type: 'canal', canals: true },
      ],
    },
    lakes: {
      1: ['Bodensee'],
      2: ['Müritz', 'Chiemsee'],
      // Not the Schweriner See: OSM splits it, and a lake in Brandenburg has the same name.
      3: ['Starnberger See', 'Ammersee', 'Steinhuder Meer', 'Edersee'],
    },
    // Mountain ranges at their highest peak; fixed coordinates where a higher peak elsewhere has
    // the same name (Lemberg, Schneeberg, ...).
    mountains: {
      1: [['Alpen', 'Zugspitze'], ['Schwarzwald', 'Feldberg'], ['Harz', 'Brocken']],
      2: [['Sauerland', 'Kahler Asten'], ['Eifel', 'Hohe Acht'], ['Hunsrück', 'Erbeskopf'], ['Bayerischer Wald', 'Großer Arber'], ['Erzgebirge', 'Fichtelberg'], ['Thüringer Wald', 'Großer Beerberg'], ['Taunus', 'Großer Feldberg'], ['Rhön', 'Wasserkuppe'], ['Schwäbische Alb', { lat: 48.1503, lon: 8.7471, ele: 1015 }]],
      3: [['Fichtelgebirge', { lat: 50.0478, lon: 11.8539, ele: 1051 }], ['Odenwald', { lat: 49.4728, lon: 9.0392, ele: 626 }], ['Spessart', { lat: 50.0119, lon: 9.3778, ele: 586 }], ['Vogelsberg', 'Taufstein'], ['Westerwald', 'Fuchskaute'], ['Teutoburger Wald', { lat: 51.8414, lon: 8.9358, ele: 468 }], ['Pfälzerwald', 'Kalmit'], ['Elbsandsteingebirge', 'Großer Zschirnstein']],
    },
    // Find them all: with the 60 listed places in data/germany.json, 100 names. Based on the
    // TopoSite list of Germany, plus well-known rivers, lakes, ranges and islands.
    core: ['Nordsee', 'Ostsee', 'Rhein', 'Elbe', 'Donau', 'Weser', 'Oder', 'Mosel', 'Ems', 'Ruhr', 'Main', 'Neckar', 'Isar', 'Inn', 'Saale', 'Spree', 'Havel',
      'Nord-Ostsee-Kanal', 'Mittellandkanal', 'Bodensee', 'Müritz', 'Chiemsee',
      'Alpen', 'Schwarzwald', 'Harz', 'Sauerland', 'Eifel', 'Hunsrück', 'Bayerischer Wald', 'Erzgebirge', 'Thüringer Wald', 'Taunus', 'Rhön', 'Schwäbische Alb',
      'Norddeutsches Tiefland', 'Ostfriesland', 'Lüneburger Heide', 'Ruhrgebiet', 'Rügen', 'Sylt'],
    // Länder (not the city states: same names as their cities), landscapes and islands.
    // Outlines are rough (no official border), cut to the land.
    zones: {
      2: [
        ...['Schleswig-Holstein', 'Niedersachsen', 'Mecklenburg-Vorpommern', 'Brandenburg', 'Sachsen-Anhalt', 'Sachsen', 'Thüringen', 'Nordrhein-Westfalen', 'Hessen', 'Rheinland-Pfalz', 'Saarland', 'Baden-Württemberg', 'Bayern'].map((name) => ({ name, type: 'state', admin1: ['DEU', name] })),
        // The lowland north of the Mittelgebirge: Rheine - Osnabrück - Hannover - Magdeburg - Leipzig - Görlitz.
        { name: 'Norddeutsches Tiefland', outline: [[5.8, 52.0], [7.0, 52.15], [7.6, 52.3], [8.3, 52.4], [9.0, 52.3], [9.7, 52.3], [10.5, 52.2], [11.2, 52.05], [11.8, 51.75], [12.3, 51.45], [13.0, 51.35], [13.8, 51.25], [15.1, 51.15], [15.1, 55.1], [5.8, 55.1]] },
        // Districts Aurich, Wittmund and Leer, and Emden, with the East Frisian islands.
        { name: 'Ostfriesland', outline: [[6.95, 53.05], [7.25, 53.0], [7.6, 53.05], [7.8, 53.25], [7.95, 53.45], [8.05, 53.55], [7.95, 53.85], [6.6, 53.85], [6.9, 53.35]] },
        { name: 'Ruhrgebiet', outline: [[6.6, 51.35], [6.6, 51.65], [7.1, 51.72], [7.7, 51.72], [7.9, 51.6], [7.6, 51.38], [7.2, 51.32], [6.9, 51.33]] },
        { name: 'Rügen', type: 'island', landAt: [13.4, 54.45] },
        { name: 'Sylt', type: 'island', landAt: [8.31, 54.9] },
      ],
      3: [
        { name: 'Lüneburger Heide', outline: [[9.6, 52.65], [10.4, 52.55], [10.85, 52.8], [10.75, 53.2], [10.2, 53.32], [9.75, 53.2], [9.5, 52.95]] },
        { name: 'Fehmarn', type: 'island', landAt: [11.15, 54.47] },
        { name: 'Usedom', type: 'island', landAt: [14.05, 53.95] },
      ],
    },
    // Seas: rough outlines with their edges on land (the land is cut out).
    waterAreas: {
      1: [
        { name: 'Nordsee', type: 'water', outline: [[5.2, 53.25], [7.2, 53.25], [8.3, 53.3], [9.35, 53.75], [9.3, 54.2], [9.0, 54.6], [8.9, 55.5], [5.2, 55.5]] },
        { name: 'Ostsee', type: 'water', outline: [[9.6, 54.35], [10.3, 53.85], [11.2, 53.85], [12.3, 54.05], [13.2, 53.95], [14.0, 53.8], [15.6, 53.8], [15.6, 55.6], [9.6, 55.6]] },
      ],
    },
  },
  finland: {
    areas: ['FI'],
    nameKeys: ['name'],
    bbox: [19.0, 59.5, 31.8, 70.2],
    rivers: {
      // Border rivers carry both names in OSM.
      1: ['Kemijoki', 'Oulujoki', 'Kymijoki', 'Kokemäenjoki', { name: 'Tornionjoki', osm: ['Tornionjoki', 'Tornionjoki / Torne älv'] }],
      // Not the Iijoki stub near Savonlinna.
      2: [['Iijoki', [24.9, 64.8, 30.2, 66.2]], 'Ounasjoki', { name: 'Tenojoki', osm: ['Tenojoki', 'Teno / Tana / Deatnu'] }, { name: 'Vuoksi', osm: ['Vuoksi', 'Vuoksi / Вуокса'] }],
      3: ['Kitinen', { name: 'Muonionjoki', osm: ['Muonionjoki', 'Muonionjoki / Muonioälven'] }, 'Aurajoki', 'Porvoonjoki', 'Vantaanjoki'],
    },
    lakes: {
      // Päijänne: from its relation (waterAreas); ponds elsewhere share the name.
      1: ['Saimaa', 'Inarijärvi', 'Oulujärvi', 'Pielinen'],
      2: ['Näsijärvi', 'Keitele', 'Kallavesi', 'Lokan tekojärvi', 'Lappajärvi'],
      3: ['Porttipahdan tekojärvi', 'Höytiäinen', 'Lohjanjärvi', 'Vanajavesi'],
    },
    // Fells (tunturit) at their top; Halti's Finnish summit has no peak name in OSM.
    mountains: {
      1: [['Halti', { lat: 69.3086, lon: 21.2672, ele: 1324 }], ['Saana', 'Saana'], ['Koli', 'Ukko-Koli']],
      2: [['Pallastunturi', 'Taivaskero'], ['Ylläs', 'Yllästunturi'], ['Levi', 'Levi'], ['Pyhätunturi', 'Noitatunturi'], ['Ruka', 'Ruka']],
      3: [['Kaunispää', 'Kaunispää'], ['Kiilopää', 'Kiilopää'], ['Iso-Syöte', 'Iso-Syöte'], ['Aavasaksa', 'Aavasaksa']],
    },
    // Find them all: with the 60 listed places in data/finland.json, 100 names.
    core: ['Suomenlahti', 'Pohjanlahti', 'Saaristomeri', 'Kemijoki', 'Oulujoki', 'Kymijoki', 'Kokemäenjoki', 'Tornionjoki', 'Iijoki', 'Ounasjoki', 'Tenojoki', 'Vuoksi',
      'Saimaa', 'Päijänne', 'Inarijärvi', 'Oulujärvi', 'Pielinen', 'Näsijärvi', 'Keitele', 'Kallavesi', 'Lokan tekojärvi', 'Lappajärvi',
      'Halti', 'Saana', 'Koli', 'Pallastunturi', 'Ylläs', 'Levi', 'Pyhätunturi', 'Ruka',
      'Lappi', 'Ahvenanmaa', 'Järvi-Suomi', 'Uusimaa', 'Pohjois-Pohjanmaa', 'Pohjois-Karjala', 'Kainuu', 'Pirkanmaa', 'Varsinais-Suomi', 'Hailuoto'],
    // Regions (maakunnat; Natural Earth names them in English), the Lakeland and islands.
    zones: {
      2: [
        ...[
          ['Lappi', 'Lapland'], ['Pohjois-Pohjanmaa', 'Northern Ostrobothnia'], ['Kainuu', 'Kainuu'], ['Pohjois-Karjala', 'North Karelia'],
          ['Etelä-Karjala', 'South Karelia'], ['Kymenlaakso', 'Kymenlaakso'], ['Uusimaa', 'Uusimaa'], ['Varsinais-Suomi', 'Finland Proper'],
          ['Satakunta', 'Satakunta'], ['Pohjanmaa', 'Ostrobothnia'], ['Keski-Pohjanmaa', 'Central Ostrobothnia'], ['Pohjois-Savo', 'Northern Savonia'],
          ['Etelä-Savo', 'Southern Savonia'], ['Keski-Suomi', 'Central Finland'], ['Etelä-Pohjanmaa', 'Southern Ostrobothnia'], ['Pirkanmaa', 'Pirkanmaa'],
          ['Kanta-Häme', 'Tavastia Proper'], ['Päijät-Häme', 'Päijät-Häme'],
        ].map(([name, ne]) => ({ name, type: 'region', admin1: ['FIN', ne] })),
        // Åland: all its municipalities.
        { name: 'Ahvenanmaa', type: 'region', admin1: ['ALD'] },
        // The lake district: Tampere - Lahti - Lappeenranta - Joensuu - Kuopio - Jyväskylä.
        { name: 'Järvi-Suomi', outline: [[23.6, 61.2], [25.2, 61.0], [27.0, 61.0], [28.6, 61.1], [29.8, 61.7], [30.4, 62.5], [29.9, 63.4], [28.4, 63.6], [26.8, 63.5], [25.4, 63.2], [24.2, 62.5], [23.6, 61.8]] },
      ],
      3: [
        { name: 'Hailuoto', type: 'island', landAt: [24.7, 65.0] },
        { name: 'Kemiönsaari', type: 'island', landAt: [22.65, 60.15] },
      ],
    },
    // Seas: rough outlines with their edges on land (the land is cut out).
    waterAreas: {
      1: [
        // Hanko - Osmussaar to St Petersburg.
        { name: 'Suomenlahti', type: 'water', outline: [[22.7, 59.25], [22.8, 59.9], [23.6, 60.15], [25.0, 60.35], [26.5, 60.6], [27.8, 60.7], [28.8, 60.85], [30.4, 60.1], [30.4, 59.5], [28.0, 59.25]] },
        // Bothnian Sea and Bothnian Bay, from the Åland Sea to Tornio.
        { name: 'Päijänne', relation: 1239779, inland: true },
        { name: 'Pohjanlahti', type: 'water', outline: [[17.3, 60.3], [19.6, 60.4], [20.6, 60.6], [21.7, 60.8], [21.8, 61.5], [21.7, 62.4], [22.0, 63.0], [23.3, 63.75], [24.6, 64.4], [25.8, 64.9], [25.6, 65.6], [24.5, 66.1], [23.0, 66.2], [21.5, 65.6], [20.5, 64.4], [18.2, 63.2], [17.0, 62.0], [17.0, 61.0]] },
      ],
      2: [
        // Between Åland and Turku.
        { name: 'Saaristomeri', type: 'water', outline: [[20.6, 59.75], [20.6, 60.55], [21.3, 60.72], [21.7, 60.72], [22.3, 60.5], [22.85, 60.3], [22.85, 59.75]] },
      ],
    },
  },
  netherlands: {
    areas: ['NL'],
    bbox: [2.9, 50.6, 7.6, 53.75],
    rivers: {
      1: [
        // From the border at Lobith: Bovenrijn (part of the German-named Rhein relation),
        // Pannerdensch Kanaal, Nederrijn. The box keeps the Rhein relation to that stretch.
        { name: 'Rijn', osm: ['Rijn', 'Bovenrijn', 'Nederrijn', 'Pannerdensch Kanaal', 'Rhein'], box: [5.3, 51.82, 6.115, 52.0], canals: true },
        // The box leaves out a creek called Waal on IJsselmonde (Rotterdam).
        { name: 'Waal', osm: ['Waal'], box: [4.9, 51.75, 6.2, 51.95] },
        'Maas', 'IJssel', 'Lek',
      ],
      2: [
        'Amstel',
        ['Vecht', [4.85, 52.0, 5.15, 52.35]],
        // Old spelling on most ways; the river relation uses the German name.
        { name: 'Overijsselse Vecht', osm: ['Vecht', 'Overijsselse Vecht', 'Overijsselsche Vecht', 'Vechte'], box: [6.0, 52.45, 7.1, 52.7] },
        'Linge', 'Oude IJssel',
        // OSM uses the old spelling.
        { name: 'Hollandse IJssel', osm: ['Hollandsche IJssel', 'Gekanaliseerde Hollandsche IJssel'] },
        'Nieuwe Maas', 'Oude Maas',
        { name: 'Merwede', osm: ['Boven-Merwede', 'Beneden-Merwede', 'Nieuwe Merwede'] },
        'Zwarte Water',
        // Canals on the basislijst topografie.
        { name: 'Noordzeekanaal', type: 'canal', canals: true },
        { name: 'Amsterdam-Rijnkanaal', type: 'canal', canals: true },
        { name: 'Nieuwe Waterweg', osm: ['Nieuwe Waterweg', 'Scheur'], type: 'canal', canals: true },
        // Utrecht – Woerden – Leiden – Katwijk; not the Oude Rijn near Zevenaar. Partly canal.
        { name: 'Oude Rijn', osm: ['Oude Rijn', 'Leidsche Rijn', 'Leidse Rijn'], box: [4.3, 52.0, 5.15, 52.25], canals: true },
      ],
      3: ['Eem', 'Dommel', 'Roer', 'Berkel', 'Dinkel', 'Regge', 'Geul', 'Niers', 'Mark', 'Schipbeek', 'Reitdiep'],
    },
    lakes: {},
    mountains: { 2: [['Vaalserberg', { lat: 50.7548, lon: 6.0207, ele: 322 }]] },
    // On the basislijst topografie (asked first); all zones, landmarks and lines below are too.
    zonesCore: 'all',
    core: ['Rijn', 'Waal', 'Maas', 'IJssel', 'Lek', 'Noordzeekanaal', 'Amsterdam-Rijnkanaal', 'Nieuwe Waterweg', 'Waddenzee', 'IJsselmeer', 'Markermeer', 'Oosterschelde', 'Westerschelde', 'Vaalserberg'],
    // Areas (gebieden) of the basislijst topografie: found by flying (well) into them.
    // Sources: a CBS province, the CBS land part (island) at a point, CBS municipalities, an OSM
    // relation or a rough outline; always cut to the land. ('areas' = Overpass country areas.)
    zones: {
      1: [
        ...[['Groningen', 'Groningen'], ['Friesland', 'Fryslân'], ['Drenthe', 'Drenthe'], ['Overijssel', 'Overijssel'], ['Flevoland', 'Flevoland'], ['Gelderland', 'Gelderland'], ['Utrecht', 'Utrecht'], ['Noord-Holland', 'Noord-Holland'], ['Zuid-Holland', 'Zuid-Holland'], ['Zeeland', 'Zeeland'], ['Noord-Brabant', 'Noord-Brabant'], ['Limburg', 'Limburg']].map(([name, cbs]) => ({ name, type: 'province', cbsProvince: cbs })),
        { name: 'Texel', type: 'island', landAt: [4.8, 53.08] },
        { name: 'Vlieland', type: 'island', landAt: [4.92, 53.23] },
        { name: 'Terschelling', type: 'island', landAt: [5.3, 53.39] },
        { name: 'Ameland', type: 'island', landAt: [5.77, 53.45] },
        { name: 'Schiermonnikoog', type: 'island', landAt: [6.2, 53.48] },
      ],
      2: [
        { name: 'Zeeuws-Vlaanderen', municipalities: ['Sluis', 'Terneuzen', 'Hulst'] },
        { name: 'Haarlemmermeer', municipalities: ['Haarlemmermeer'] },
        { name: 'Twente', municipalities: ["Almelo","Borne","Dinkelland","Enschede","Haaksbergen","Hellendoorn","Hengelo (O.)","Hof van Twente","Losser","Oldenzaal","Rijssen-Holten","Tubbergen","Twenterand","Wierden"] },
        { name: 'Veluwe', relation: 2762589 }, // Natura 2000 area
        { name: 'Biesbos', relation: 14616038 }, // Nationaal Park De Biesbosch
        { name: 'Rijnmond', relation: 11961545 }, // veiligheidsregio Rotterdam-Rijnmond
        // No official border: a generous ring around the four big cities and the Groene Hart.
        { name: 'Randstad', outline: [[4.55, 52.52], [4.85, 52.5], [5.08, 52.46], [5.3, 52.38], [5.42, 52.2], [5.2, 51.98], [4.85, 51.78], [4.55, 51.8], [4.3, 51.84], [4.08, 51.98], [4.25, 52.12], [4.42, 52.28]] },
      ],
    },
    // Points of the basislijst: Schiphol (airport), Vaalserberg (in mountains below).
    landmarks: { 2: [{ name: 'Schiphol', type: 'airport', lat: 52.3086, lon: 4.7639 }] },
    // Lines to follow that are not waterways: the Afsluitdijk (its A7 carriageways).
    lines: { 2: [{ name: 'Afsluitdijk', type: 'dike', query: 'way["name"="Afsluitdijk"]["highway"="motorway"]' }] },
    waterAreas: {
      1: [
        { name: 'Waddenzee', relation: 5909370, type: 'water' }, // protected-area boundary: land is cut out
        { name: 'IJsselmeer', relation: 945096 },
        { name: 'Markermeer', relation: 49368 },
      ],
      2: [
        { name: 'Oosterschelde', relation: 6846427, type: 'water' },
        // Not a polygon in OSM (sea per the coastline): rough outline from the mouth
        // (Vlissingen - Breskens) to the Belgian border, with its edges on land.
        {
          name: 'Westerschelde',
          type: 'water',
          outline: [[3.5, 51.47], [3.6, 51.475], [3.8, 51.475], [3.95, 51.465], [4.05, 51.465], [4.15, 51.445], [4.24, 51.425], [4.25, 51.37], [4.2, 51.345], [4.0, 51.325], [3.8, 51.325], [3.6, 51.355], [3.5, 51.375]],
        },
      ],
    },
    // Background water, drawn but never asked: the connections that make the rivers reach the
    // sea (the base map draws these as part of its rivers, the detailed layer replaces it).
    context: {
      lines: [
        'Nieuwe Waterweg', 'Scheur', 'Het Scheur', 'Noord', 'Dordtsche Kil', 'Spui', 'Amer', 'Bergsche Maas',
        'Afgedamde Maas', 'Pannerdensch Kanaal', 'Noordzeekanaal', 'Lekkanaal',
      ],
      // Real water surfaces (river banks, harbours, lakes…) so wide water such as the delta
      // and the Rotterdam port is drawn at its true shape; pieces under minKm2 are dropped.
      // interval: simplification in metres (one screen pixel is ~200 m on this map).
      surfaces: { types: ['river', 'canal', 'lake', 'harbour', 'basin', 'lagoon'], minKm2: 0.2, interval: 150 },
      areas: ['Hollandsch Diep', 'Hollands Diep', 'Brielse Meer', 'Haringvliet', 'IJ', 'Ketelmeer', 'Zwarte Meer', 'Volkerak', 'Biesbosch'],
    },
  },
};

// ---------- helpers ----------

const norm = (s) => s.normalize('NFC').toLowerCase();

async function overpass(key, query) {
  const file = path.join(CACHE, `overpass-${key}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    let res;
    // Public servers are flaky: up to three rounds over all servers, pausing in between.
    const attempts = [...OVERPASS, ...OVERPASS, ...OVERPASS];
    for (const [i, url] of attempts.entries()) {
      if (i > 0 && i % OVERPASS.length === 0) await new Promise((r) => setTimeout(r, 15000));
      console.log(`  querying ${new URL(url).host} (${key})...`);
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'topo-heli-map-builder/0.1 (hobby geography game)',
          },
          body: new URLSearchParams({ data: query }),
        });
      } catch (e) {
        console.warn(`  ! ${e.cause?.code ?? e.message}, trying next server`);
        res = { ok: false, status: 'no answer', text: async () => '' };
        continue;
      }
      // An empty answer is usually a server hiccup: try the next server instead of caching it.
      if (res.ok) {
        const text = await res.clone().text();
        if (JSON.parse(text).elements?.length) break;
        console.warn(`  ! empty answer, trying next server`);
        res = { ok: false, status: 'empty', text: async () => text };
        continue;
      }
      console.warn(`  ! ${res.status}, trying next server`);
    }
    if (!res.ok) throw new Error(`Overpass failed (${res.status}): ${await res.text()}`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return JSON.parse(text);
  }
}

/** Builds a regex alternation matching Latin and Cyrillic spellings. */
const nameRegex = (names) => `^(${names.flatMap((n) => [n, toCyrillic(n)]).join('|')})$`;

const NAME_KEYS = ['name', 'name:sr', 'name:sr-Latn'];
/** Finds which configured name an OSM element carries (any of the name keys). */
function matchName(tags, names) {
  for (const key of NAME_KEYS) {
    const v = tags?.[key];
    if (!v) continue;
    const hit = names.find((n) => norm(n) === norm(v) || norm(toCyrillic(n)) === norm(v));
    if (hit) return hit;
  }
  return null;
}

function areaQuery(cfg) {
  return cfg.areas.map((cc, i) => `area["ISO3166-1"="${cc}"]["admin_level"="2"]->.a${i};`).join('\n');
}
const inAreas = (cfg, filter, keys = cfg.nameKeys ?? NAME_KEYS) =>
  cfg.areas.map((_, i) => keys.map((k) => `${filter}["${k}"~"__RE__",i](area.a${i});`).join('\n')).join('\n');

/**
 * The playable country (from the map's geo.json) grown by `km`, as a clip layer: keeps
 * rivers inside the country, while border rivers (Danube, Drina…) are not chopped up.
 */
async function countryClip(id, km) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  const home = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: geo.home } }] };
  return simplifyGeo(home, `-buffer radius=${km}km`);
}

/** The playable country itself (no margin): drawing layers are clipped to exactly this. */
async function homeShape(id) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: geo.home } }] };
}

/** Clips lon/lat lines or polygons to the country, for drawing without a per-frame clip. */
async function clipToHome(id, geometries, kind) {
  if (!geometries.length) return [];
  const features = geometries.map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: kind === 'line' ? 'LineString' : 'Polygon', coordinates },
  }));
  const out = await mapshaper.applyCommands('-i in.json -clip home.json -o out.json format=geojson', {
    'in.json': { type: 'FeatureCollection', features },
    'home.json': await homeShape(id),
  });
  const fc = JSON.parse(out['out.json']);
  const result = [];
  // Without attributes mapshaper writes a GeometryCollection instead of features.
  for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
    if (!g) continue;
    if (g.type === 'LineString' || g.type === 'Polygon') result.push(g.coordinates);
    else if (g.type === 'MultiLineString' || g.type === 'MultiPolygon') result.push(...g.coordinates);
  }
  return round(result);
}

async function simplifyGeo(fc, cmd) {
  const out = await mapshaper.applyCommands(`-i in.json ${cmd} -o out.json format=geojson`, { 'in.json': fc });
  const res = JSON.parse(out['out.json']);
  return res.type === 'FeatureCollection' ? res : { type: 'FeatureCollection', features: (res.geometries ?? []).map((geometry) => ({ type: 'Feature', properties: {}, geometry })) };
}

const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));
const byLevel = (obj) => Object.entries(obj).flatMap(([level, list]) => list.map((item) => ({ level: +level, item })));

// ---------- builders ----------

async function buildRivers(id, cfg, key = 'rivers', waterways = 'river|canal') {
  const entries = byLevel(cfg.rivers).map(({ level, item }) => {
    if (typeof item === 'string') return { level, name: item, osm: [item] };
    if (Array.isArray(item)) return { level, name: item[0], osm: [item[0]], box: item[1] };
    return { level, name: item.name, osm: item.osm ?? [item.name], box: item.box, canals: item.canals, type: item.type };
  });
  if (!entries.length) return [];
  const osmNames = [...new Set(entries.flatMap((e) => e.osm))];
  const re = nameRegex(osmNames);
  const inBox = (box, [x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const [w, so, e, n] = cfg.bbox;
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, `way["waterway"~"^(${waterways})$"]`).replaceAll('__RE__', re)}\n${inAreas(cfg, `relation["waterway"~"^(${waterways})$"]`).replaceAll('__RE__', re)}\n);\nout geom(${so},${w},${n},${e});`;
  const data = await overpass(`${id}-${key}-v4`, query);

  const features = [];
  // Way id -> { river, coords }. A way can come in directly and as a relation member: keep it once,
  // otherwise its length would count twice when following the river.
  const ways = new Map();
  const add = (wayId, osmName, geometry, waterway) => {
    const coords = (geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
    if (coords.length < 2 || ways.has(wayId)) return;
    const entry = entries.find(
      (en) =>
        en.osm.includes(osmName) &&
        (!en.box || coords.some((c) => inBox(en.box, c))) &&
        (waterway !== 'canal' || en.canals || key !== 'rivers'),
    );
    if (entry) ways.set(wayId, { river: entry.name, coords });
  };
  // Named ways first, then relation members.
  for (const el of data.elements) {
    const osmName = matchName(el.tags, osmNames);
    if (osmName && el.type === 'way') add(el.id, osmName, el.geometry, el.tags.waterway);
  }
  for (const el of data.elements) {
    const osmName = matchName(el.tags, osmNames);
    if (!osmName || el.type !== 'relation') continue;
    // Side streams (e.g. unnamed side channels of the Rhein relation) are not the river itself.
    for (const m of el.members ?? []) if (m.type === 'way' && m.role !== 'side_stream') add(m.ref, osmName, m.geometry, el.tags.waterway);
  }
  if (!ways.size) {
    console.warn(`  ! no waterways found for ${key}`);
    return [];
  }
  for (const { river, coords } of ways.values()) {
    features.push({ type: 'Feature', properties: { feat: river }, geometry: { type: 'LineString', coordinates: coords } });
  }
  const clip = await countryClip(id, 2);
  const out = await mapshaper.applyCommands(
    '-i in.json -clip clip.json -dissolve feat -simplify interval=400 -o out.json format=geojson',
    { 'in.json': { type: 'FeatureCollection', features }, 'clip.json': clip },
  );
  const fc = JSON.parse(out['out.json']);
  const result = [];
  for (const { level, name, box, type } of entries) {
    const f = fc.features.find((x) => x.properties.feat === name);
    if (!f) {
      console.warn(`  ! river not found: ${name}`);
      continue;
    }
    const g = f.geometry;
    let lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    if (box) lines = lines.filter((l) => l.some((c) => inBox(box, c)));
    result.push({ name, level, ...(type ? { type } : {}), lines: round(lines) });
  }
  return result;
}

async function buildLakes(id, cfg, key = 'lakes') {
  const entries = byLevel(cfg.lakes).map(({ level, item }) =>
    Array.isArray(item) ? { level, item: item[1], shown: item[0] } : { level, item, shown: item },
  );
  if (!entries.length) return [];
  const names = entries.map((e) => e.item);
  const re = nameRegex(names);
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, 'nwr["natural"="water"]', cfg.nameKeys ?? ['name', 'name:sr']).replaceAll('__RE__', re)}\n);\nout geom;`;
  const data = await overpass(`${id}-${key}`, query);

  const features = [];
  for (const el of data.elements) {
    const name = matchName(el.tags, names);
    if (!name) continue;
    if (el.type === 'way' && el.geometry) {
      features.push({ type: 'Feature', properties: { feat: name }, geometry: { type: 'Polygon', coordinates: [el.geometry.map((p) => [p.lon, p.lat])] } });
    } else if (el.type === 'relation') {
      // Outer members only; holes (islands) don't matter for the game.
      for (const m of el.members ?? []) {
        if (m.role === 'outer' && m.geometry) {
          features.push({ type: 'Feature', properties: { feat: name }, geometry: { type: 'LineString', coordinates: m.geometry.map((p) => [p.lon, p.lat]) } });
        }
      }
    }
  }
  // Relation outers come as pieces: -polygons stitches lines into rings.
  const lines = features.filter((f) => f.geometry.type === 'LineString');
  const polys = features.filter((f) => f.geometry.type === 'Polygon');
  let stitched = [];
  for (const name of new Set(lines.map((f) => f.properties.feat))) {
    const fc = await simplifyGeo({ type: 'FeatureCollection', features: lines.filter((f) => f.properties.feat === name) }, '-polygons gap-tolerance=0.001');
    stitched.push(...fc.features.map((f) => ({ ...f, properties: { feat: name } })));
  }
  const fc = await simplifyGeo({ type: 'FeatureCollection', features: [...polys, ...stitched] }, '-dissolve feat -simplify interval=150 keep-shapes');

  const result = [];
  for (const { level, item: osmName, shown } of entries) {
    const f = fc.features.find((x) => x.properties.feat === osmName && x.geometry);
    if (!f) {
      console.warn(`  ! lake not found: ${osmName}`);
      continue;
    }
    const g = f.geometry;
    const rings = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p[0]);
    result.push({ name: shown, level, rings: round(rings) });
  }
  return result;
}

async function buildMountains(id, cfg) {
  const entries = byLevel(cfg.mountains);
  if (!entries.length) return [];
  const peaks = entries.map((e) => e.item[1]).filter((p) => typeof p === 'string');
  const re = nameRegex(peaks);
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, 'node["natural"="peak"]').replaceAll('__RE__', re)}\n);\nout;`;
  // Only fixed coordinates (no peak names to look up): nothing to query.
  const data = peaks.length ? await overpass(`${id}-peaks`, query) : { elements: [] };

  const result = [];
  for (const { level, item: [name, peak] } of entries) {
    if (typeof peak === 'object') {
      result.push({ name, level, ...peak });
      continue;
    }
    // Several peaks can share a name: take the highest.
    const hits = data.elements
      .filter((el) => matchName(el.tags, [peak]))
      .sort((a, b) => (parseFloat(b.tags.ele) || 0) - (parseFloat(a.tags.ele) || 0));
    if (!hits.length) {
      console.warn(`  ! peak not found: ${peak} (${name})`);
      continue;
    }
    const h = hits[0];
    result.push({ name, level, lat: +h.lat.toFixed(4), lon: +h.lon.toFixed(4), ele: parseFloat(h.tags.ele) || null });
  }
  return result;
}

/**
 * Water surfaces of the given OSM water types: closed ways and multipolygons (outer rings minus
 * inner rings, so islands stay land), merged, small pieces dropped, clipped to the country.
 */
async function buildSurfaces(id, cfg) {
  const { types, minKm2, interval = 150 } = cfg.context.surfaces;
  const re = `^(${types.join('|')})$`;
  const query = `[out:json][timeout:600];\n${areaQuery(cfg)}\n(\n${cfg.areas
    .map((_, i) => `way["natural"="water"]["water"~"${re}"](area.a${i});\nrelation["natural"="water"]["water"~"${re}"](area.a${i});`)
    .join('\n')}\n);\nout geom;`;
  const data = await overpass(`${id}-surfaces`, query);

  const toCoords = (geometry) => (geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
  const outer = [];
  const inner = [];
  const line = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  for (const el of data.elements) {
    if (el.type === 'way') {
      const c = toCoords(el.geometry);
      if (c.length >= 4) outer.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c] } });
      continue;
    }
    // Multipolygon members come as pieces: stitch each relation's outer and inner rings separately.
    const pieces = { outer: [], inner: [] };
    for (const m of el.members ?? []) {
      if (m.type === 'way' && (m.role === 'outer' || m.role === 'inner')) pieces[m.role].push(line(toCoords(m.geometry)));
    }
    for (const role of ['outer', 'inner']) {
      if (!pieces[role].length) continue;
      const fc = await simplifyGeo({ type: 'FeatureCollection', features: pieces[role] }, '-polygons gap-tolerance=0.0005');
      (role === 'outer' ? outer : inner).push(...fc.features.map((f) => ({ ...f, properties: {} })));
    }
  }
  const clip = await countryClip(id, 0.5);
  const result = await mapshaper.applyCommands(
    `-i outer.json -dissolve2 -erase inner.json -explode -filter "this.area > ${minKm2 * 1e6}" -simplify interval=${interval} keep-shapes -clip clip.json -o out.json format=geojson`,
    {
      'outer.json': { type: 'FeatureCollection', features: outer },
      'inner.json': { type: 'FeatureCollection', features: inner },
      'clip.json': clip,
    },
  );
  const fc = JSON.parse(result['out.json']);
  const polys = [];
  for (const f of fc.features ?? fc.geometries?.map((geometry) => ({ geometry })) ?? []) {
    const g = f.geometry;
    if (g?.type === 'Polygon') polys.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  console.log(`  water surfaces: ${outer.length} shapes, ${inner.length} islands -> ${polys.length} polygons`);
  return round(polys);
}

/** CBS land per province (made by build-map.mjs) and CBS municipalities (PDOK). */
async function cbsData() {
  const land = JSON.parse(await fs.readFile(path.join(CACHE, 'cbs-province-land-150.json'), 'utf8').catch(() => {
    throw new Error('Run "npm run build:map" first (it builds .cache/cbs-province-land-150.json).');
  }));
  const file = path.join(CACHE, 'cbs-gemeente-2024.json');
  let municipalities;
  try {
    municipalities = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    console.log('  downloading CBS municipalities...');
    const res = await fetch('https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=gebiedsindelingen:gemeente_gegeneraliseerd&outputFormat=application/json&srsName=EPSG:4326&count=5000');
    if (!res.ok) throw new Error(`PDOK download failed (${res.status})`);
    const text = await res.text();
    await fs.writeFile(file, text);
    municipalities = JSON.parse(text);
  }
  return { land, municipalities };
}

const polysOf = (fc) => {
  const polys = [];
  for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
    if (g?.type === 'Polygon') polys.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  return polys;
};
const featureOf = (coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } });
function insideRingLL([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Land of a map that is not built from CBS data: its own playable area (geo.json), and its
 * Natural Earth admin-1 regions (e.g. the German Länder), cached by build-map.mjs.
 */
async function homeLand(id) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  const admin1 = JSON.parse(await fs.readFile(path.join(CACHE, 'ne_10m_admin_1_states_provinces.geojson'), 'utf8').catch(() => {
    throw new Error('Run "npm run build:map" first (it downloads the Natural Earth admin-1 regions).');
  }));
  return { land: { type: 'FeatureCollection', features: geo.home.map(featureOf) }, municipalities: { features: [] }, admin1 };
}

/** Areas (gebieden): see `zones` in the config. Output like lakes: outer rings + holes. */
async function buildAreas(id, cfg) {
  const entries = byLevel(cfg.zones ?? {});
  if (!entries.length) return [];
  const { land, municipalities, admin1 } = cfg.areas.includes('NL') ? await cbsData() : await homeLand(id);
  const ids = entries.map((e) => e.item.relation).filter(Boolean);
  const data = ids.length
    ? await overpass(`${id}-arearelations-${ids.join('-')}`, `[out:json][timeout:300];\n(${ids.map((r) => `relation(${r});`).join('')});\nout geom;`)
    : { elements: [] };
  const landFc = { type: 'FeatureCollection', features: land.features.map((f) => ({ ...f, properties: {} })) };
  const line = (geometry) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geometry.filter(Boolean).map((p) => [p.lon, p.lat]) } });
  const result = [];
  for (const { level, item } of entries) {
    let shapes = [];
    if (item.cbsProvince) shapes = land.features.filter((f) => f.properties.prov === item.cbsProvince);
    // [country, region]; [country] alone: all its regions (Åland).
    if (item.admin1) shapes = admin1.features.filter((f) => f.properties.adm0_a3 === item.admin1[0] && (!item.admin1[1] || f.properties.name === item.admin1[1]));
    if (item.landAt) {
      const part = polysOf(land).find((p) => insideRingLL(item.landAt, p[0]));
      if (part) shapes = [featureOf(part)];
    }
    if (item.municipalities) shapes = municipalities.features.filter((f) => item.municipalities.includes(f.properties.statnaam));
    if (item.relation) {
      const rel = data.elements.find((e) => e.type === 'relation' && e.id === item.relation);
      const outer = (rel?.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => line(m.geometry));
      if (outer.length) shapes = (await simplifyGeo({ type: 'FeatureCollection', features: outer }, '-polygons gap-tolerance=0.0005')).features;
    }
    if (item.outline) shapes = [featureOf([[...item.outline, item.outline[0]]])];
    if (!shapes.length) {
      console.warn(`  ! area not found: ${item.name}`);
      continue;
    }
    const out = await mapshaper.applyCommands(
      '-i area.json -dissolve -clip land.json -simplify interval=250 keep-shapes -filter-slivers -o out.json format=geojson',
      { 'area.json': { type: 'FeatureCollection', features: shapes.map((f) => ({ ...f, properties: {} })) }, 'land.json': landFc },
    );
    const polys = polysOf(JSON.parse(out['out.json']));
    if (!polys.length) {
      console.warn(`  ! area empty on land: ${item.name}`);
      continue;
    }
    result.push({ name: item.name, level, ...(item.type ? { type: item.type } : {}), rings: round(polys.map((p) => p[0])), holes: round(polys.flatMap((p) => p.slice(1))) });
  }
  return result;
}

/** Lines that are not waterways (e.g. the Afsluitdijk): played like rivers. */
async function buildLines(id, cfg) {
  const entries = byLevel(cfg.lines ?? {});
  const result = [];
  for (const { level, item } of entries) {
    const data = await overpass(`${id}-line-${item.name}`, `[out:json][timeout:120];\n${item.query}(${cfg.bbox[1]},${cfg.bbox[0]},${cfg.bbox[3]},${cfg.bbox[2]});\nout geom;`);
    const features = data.elements
      .filter((e) => e.type === 'way' && e.geometry)
      .map((e) => ({ type: 'Feature', properties: { feat: 1 }, geometry: { type: 'LineString', coordinates: e.geometry.map((p) => [p.lon, p.lat]) } }));
    if (!features.length) {
      console.warn(`  ! line not found: ${item.name}`);
      continue;
    }
    // Two carriageways: keep one line per stretch by simplifying the merged lines generously.
    const fc = await simplifyGeo({ type: 'FeatureCollection', features }, '-dissolve feat -simplify interval=300');
    const lines = [];
    for (const g of fc.features.map((f) => f.geometry)) {
      if (g?.type === 'LineString') lines.push(g.coordinates);
      else if (g?.type === 'MultiLineString') lines.push(...g.coordinates);
    }
    // Keep only the longest line (one carriageway): the other would double the length to follow.
    const len = (l) => l.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0);
    lines.sort((a, b) => len(b) - len(a));
    result.push({ name: item.name, level, type: item.type, lines: round([lines[0]]) });
  }
  return result;
}

/** Large water areas (see `waterAreas` in the config), land cut out. */
async function buildWaterAreas(id, cfg) {
  const entries = byLevel(cfg.waterAreas ?? {});
  if (!entries.length) return [];
  const ids = entries.map((e) => e.item.relation).filter(Boolean);
  const data = ids.length
    ? await overpass(`${id}-waterareas-${ids.join('-')}`, `[out:json][timeout:300];\n(${ids.map((r) => `relation(${r});`).join('')});\nout geom;`)
    : { elements: [] };
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  const land = {
    type: 'FeatureCollection',
    features: [...geo.home, ...geo.neighbours].map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } })),
  };
  const line = (geometry) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geometry.filter(Boolean).map((p) => [p.lon, p.lat]) } });
  const result = [];
  for (const { level, item } of entries) {
    const shapes = [];
    // An inland lake lies on the (Natural Earth) land: only its own islands are cut out.
    const cut = item.inland ? { type: 'FeatureCollection', features: [] } : land;
    if (item.relation) {
      const rel = data.elements.find((e) => e.type === 'relation' && e.id === item.relation);
      if (!rel) {
        console.warn(`  ! water area relation not found: ${item.name}`);
        continue;
      }
      const outer = (rel.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => line(m.geometry));
      const inner = (rel.members ?? []).filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => line(m.geometry));
      const outerFc = await simplifyGeo({ type: 'FeatureCollection', features: outer }, '-polygons gap-tolerance=0.0005');
      shapes.push(...outerFc.features);
      if (inner.length) {
        const innerFc = await simplifyGeo({ type: 'FeatureCollection', features: inner }, '-polygons gap-tolerance=0.0005');
        cut.features.push(...innerFc.features.map((f) => ({ ...f, properties: {} })));
      }
    }
    if (item.outline) shapes.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...item.outline, item.outline[0]]] } });
    const out = await mapshaper.applyCommands(
      '-i area.json -dissolve -erase land.json -simplify interval=150 keep-shapes -filter-slivers -o out.json format=geojson',
      { 'area.json': { type: 'FeatureCollection', features: shapes.map((f) => ({ ...f, properties: {} })) }, 'land.json': cut },
    );
    const fc = JSON.parse(out['out.json']);
    const polys = [];
    for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
      if (g?.type === 'Polygon') polys.push(g.coordinates);
      else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates);
    }
    if (!polys.length) {
      console.warn(`  ! water area empty after cutting out land: ${item.name}`);
      continue;
    }
    // rings: outer rings; holes: islands (flying over an island is not over the water).
    result.push({ name: item.name, level, ...(item.type ? { type: item.type } : {}), rings: round(polys.map((p) => p[0])), holes: round(polys.flatMap((p) => p.slice(1))) });
  }
  return result;
}

async function build(id, cfg) {
  console.log(`Building physical features for ${id}`);
  const out = {
    rivers: await buildRivers(id, cfg),
    lakes: [...(await buildLakes(id, cfg)), ...(await buildWaterAreas(id, cfg))],
    mountains: await buildMountains(id, cfg),
  };
  if (cfg.lines) out.rivers.push(...(await buildLines(id, cfg)));
  if (cfg.zones) out.areas = await buildAreas(id, cfg);
  if (cfg.landmarks) out.landmarks = byLevel(cfg.landmarks).map(({ level, item }) => ({ level, ...item }));
  if (cfg.core) {
    const mark = (list, all = false) => list?.forEach((x) => (all || cfg.core.includes(x.name)) && (x.core = true));
    mark(out.rivers.filter((r) => r.type !== 'dike'));
    mark(out.rivers.filter((r) => r.type === 'dike'), true);
    mark(out.lakes);
    mark(out.mountains);
    mark(out.areas, cfg.zonesCore === 'all');
    mark(out.landmarks, true);
  }

  // Background water (never asked): connections to the sea, river banks, harbours, …
  let contextLines = [];
  let contextAreas = [];
  if (cfg.context) {
    const lines = await buildRivers(id, { ...cfg, rivers: { 1: cfg.context.lines } }, 'context-lines');
    const areas = await buildLakes(id, { ...cfg, lakes: { 1: cfg.context.areas } }, 'context-areas');
    const surfaces = cfg.context.surfaces ? await buildSurfaces(id, cfg) : [];
    contextLines = lines.flatMap((r) => r.lines);
    contextAreas = [...areas.map((a) => a.rings), ...surfaces];
    console.log(`  background water: ${lines.length} waterways, ${areas.length} named areas, ${surfaces.length} surfaces`);
  }

  // Drawing layers, pre-clipped to the country so the game needs no per-frame clipping. The
  // targets above keep their full geometry (incl. a margin along border rivers) for finding them.
  const riversOfLevel = (lv) => out.rivers.filter((r) => r.type !== 'dike' && Math.min(r.level, 3) === lv).flatMap((r) => r.lines);
  out.draw = {
    rivers: [await clipToHome(id, riversOfLevel(1), 'line'), await clipToHome(id, riversOfLevel(2), 'line'), await clipToHome(id, riversOfLevel(3), 'line')],
    lines: await clipToHome(id, contextLines, 'line'),
    // Water areas (holes = islands) lie outside the land: drawn from their own shape in the game.
    water: await clipToHome(id, [...out.lakes.filter((l) => !l.holes).map((l) => l.rings), ...contextAreas], 'polygon'),
  };

  const file = path.join(ROOT, 'src', 'maps', id, 'physical.json');
  await fs.writeFile(file, JSON.stringify(out));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`  ${out.rivers.length} rivers, ${out.lakes.length} lakes, ${out.mountains.length} mountains -> ${path.relative(ROOT, file)} (${kb} KB)`);
  if (id === 'finland') await addFinnishSerbianNames(out);
}

/** Finland: Serbian names of the features, transcribed where names.sr.json (build-places) has none. */
async function addFinnishSerbianNames(out) {
  const file = path.join(ROOT, 'src', 'maps', 'finland', 'names.sr.json');
  const names = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const x of [...out.rivers, ...out.lakes, ...out.mountains, ...(out.areas ?? [])]) names[x.name] ??= toCyrillic(finnishToSerbian(x.name));
  const sorted = Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b, 'fi')));
  await fs.writeFile(file, JSON.stringify(sorted, null, 2) + '\n');
}


/**
 * Province maps reuse the country's data: rivers cut to the province (with the same margin as
 * the country), drawing layers clipped to it. No river long enough -> no physical file.
 */
async function buildDerived(id, fromId) {
  const from = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', fromId, 'physical.json'), 'utf8'));
  const clip = await countryClip(id, 2);
  // Length is measured just around the province: a river along the border counts (the Maas
  // between Brabant and Gelderland), one only within the 2 km drawing margin does not (the Waal).
  const clipNear = await countryClip(id, 0.5);
  const lengthKm = (lines) => {
    const d = Math.PI / 180;
    let L = 0;
    for (const l of lines) for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]];
      L += 6371 * Math.hypot((b[0] - a[0]) * d * Math.cos(((a[1] + b[1]) / 2) * d), (b[1] - a[1]) * d);
    }
    return L;
  };
  const rivers = [];
  const clipLines = async (r, area) => {
    const out = await mapshaper.applyCommands('-i in.json -clip clip.json -o out.json format=geojson', {
      'in.json': { type: 'FeatureCollection', features: r.lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) },
      'clip.json': area,
    });
    const fc = JSON.parse(out['out.json']);
    const lines = [];
    for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
      if (g?.type === 'LineString') lines.push(g.coordinates);
      else if (g?.type === 'MultiLineString') lines.push(...g.coordinates);
    }
    return lines;
  };
  for (const r of from.rivers) {
    if (lengthKm(await clipLines(r, clipNear)) < MIN_PROVINCE_RIVER_KM) continue;
    rivers.push({ ...r, lines: round(await clipLines(r, clip)) });
  }
  const file = path.join(ROOT, 'src', 'maps', id, 'physical.json');

  // Water areas (IJsselmeer, Oosterschelde, …) next to the province: kept whole.
  const home = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8')).home;
  const homePts = home.flat(2);
  const near = (rings) =>
    rings.some((r) => r.some(([x, y]) => homePts.some(([hx, hy]) => Math.abs(hx - x) < 0.02 && Math.abs(hy - y) < 0.014)));
  // Some waters touch a province only at its edge (Noord-Brabant and the Oosterschelde).
  const skip = PROVINCES.find((p) => p.id === id)?.skipPhysical ?? [];
  // Areas mostly inside the province (not the provinces themselves); points inside it.
  const inHome = (pt) => home.some((poly) => insideRingLL(pt, poly[0]));
  // Lakes inside the land (Serbia) or next to it (Dutch waters lie outside the CBS land).
  const lakes = from.lakes.filter((l) => (near(l.rings) || l.rings.some((r) => r.some(inHome))) && !skip.includes(l.name));
  // Test points inside the area (a grid), not its outline: outline points lie on the very border.
  const interior = (a) => {
    const pts = a.rings.flat();
    const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
    const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    const grid = [];
    for (let i = 0.5; i < 12; i++) for (let j = 0.5; j < 12; j++) grid.push([x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * j) / 12]);
    return grid.filter((p) => a.rings.some((r) => insideRingLL(p, r)));
  };
  const areas = (from.areas ?? []).filter((a) => {
    if (a.type === 'province' || a.type === 'state') return false;
    const pts = interior(a);
    return pts.length > 0 && pts.filter(inHome).length >= 0.5 * pts.length;
  });
  // Peaks often lie on a border (Stara planina, Kopaonik): also those just outside, in both maps.
  const nearKm = (m, maxKm) =>
    homePts.some(([x, y]) => 111 * Math.hypot((x - m.lon) * Math.cos((m.lat * Math.PI) / 180), y - m.lat) < maxKm);
  // A peak just outside is moved to the nearest spot well inside the map (still within the
  // range), so you find it by flying in your own region, not over the grey neighbours.
  const kmX = 111 * Math.cos((homePts[0][1] * Math.PI) / 180);
  const edges = home.flat().flatMap((r) => r.slice(1).map((b, i) => [r[i], b]));
  const borderKm = ([x, y]) =>
    Math.min(...edges.map(([[ax, ay], [bx, by]]) => {
      const [px, py, dx, dy] = [(x - ax) * kmX, (y - ay) * 111, (bx - ax) * kmX, (by - ay) * 111];
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(px - t * dx, py - t * dy);
    }));
  const moveInside = (m) => {
    let best = null;
    for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
      const p = [m.lon + (i * 0.5) / kmX, m.lat + (j * 0.5) / 111];
      const d = Math.hypot(i, j) * 0.5;
      if (d > 10 || !inHome(p) || borderKm(p) < MOUNTAIN_INSIDE_KM) continue;
      if (!best || d < best.d) best = { d, p };
    }
    if (!best) return m;
    console.log(`  ${id}: ${m.name} moved ${best.d.toFixed(1)} km inside`);
    return { ...m, lon: +best.p[0].toFixed(4), lat: +best.p[1].toFixed(4) };
  };
  const mountains = (from.mountains ?? [])
    .filter((m) => inHome([m.lon, m.lat]) || nearKm(m, 3))
    .map((m) => (inHome([m.lon, m.lat]) ? m : moveInside(m)));
  const landmarks = (from.landmarks ?? []).filter((m) => inHome([m.lon, m.lat]));
  if (!rivers.length && !lakes.length && !areas.length && !mountains.length && !landmarks.length) {
    await fs.rm(path.join(ROOT, 'src', 'maps', id, 'physical.json'), { force: true });
    console.log(`  ${id}: no rivers of ${MIN_PROVINCE_RIVER_KM}+ km and no waters`);
    return;
  }
  const out = {
    rivers,
    lakes,
    mountains,
    areas,
    landmarks,
    draw: {
      rivers: await Promise.all(from.draw.rivers.map((lines) => clipToHome(id, lines, 'line'))),
      lines: await clipToHome(id, from.draw.lines, 'line'),
      water: await clipToHome(id, from.draw.water, 'polygon'),
    },
  };
  await fs.writeFile(file, JSON.stringify(out));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`  ${id}: ${rivers.length} rivers/canals/dikes, ${lakes.length} waters, ${areas.length + mountains.length + landmarks.length} areas/points (${[...rivers, ...lakes, ...areas, ...mountains, ...landmarks].map((r) => r.name).join(', ')}) -> ${kb} KB`);
  // The menu calls the mode "Waters & areas" where there are areas or points.
  const manifestFile = path.join(ROOT, 'src', 'maps', 'nl-provinces.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const entry = manifest.find((m) => m.id === id);
  if (entry) {
    entry.areas = areas.length + mountains.length + landmarks.length > 0;
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
}

const only = process.argv[2];
for (const [id, cfg] of Object.entries(PHYSICAL)) {
  if (!only || only === id) await build(id, cfg);
}
// Provinces are derived from the Netherlands: `npm run build:physical -- provinces` (or no argument).
if (!only || only === 'netherlands' || only === 'provinces') {
  console.log('Deriving province rivers from netherlands');
  for (const p of PROVINCES) await buildDerived(p.id, 'netherlands');
}
// Serbian regions are derived from Serbia: `npm run build:physical -- regions` (or no argument).
if (!only || only === 'serbia' || only === 'regions') {
  console.log('Deriving region rivers from serbia');
  for (const r of SERBIA_REGIONS) await buildDerived(r.id, 'serbia');
}
// German regions are derived from Germany: `npm run build:physical -- de-regions` (or no argument).
if (!only || only === 'germany' || only === 'de-regions') {
  console.log('Deriving region rivers from germany');
  for (const r of GERMANY_REGIONS) await buildDerived(r.id, 'germany');
}
