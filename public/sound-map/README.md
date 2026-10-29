# Fukuoka Sound Map Assets

These are static city-model and wayfinding assets only. They contain no visitor recordings, public tokens, private audio URLs, account data or production database exports.

- `fukuoka-lite.json`: simplified from the existing physical map's `output_road_aware_print_v11/source_geometry.json`, retaining 1,600 larger building footprints, roads and water. Coordinates are the physical model's millimeter frame; this is not a live city survey.
- `fukuoka-west.json`: western extension toward Ohori Park, independently extracted from the same local PLATEAU CityGML sources, with 450 larger footprints and simplified roads/water. It does not change the physical-model project.
- `fukuoka-labels.json`: 83 geographic reference labels from the existing wayfinding catalog and coordinate index. Source references are retained per label; text reference points are not surveyed roof/install anchors. Street orientation is a simplified display direction, not a navigation route.

Source: Japan Ministry of Land, Infrastructure, Transport and Tourism, Project PLATEAU, Fukuoka City 2024 CityGML package. The building survey underlying these models is 2022, not 2024 or 2026. This project crops, simplifies and changes vertical presentation. Source catalog: https://www.geospatial.jp/ckan/dataset/plateau-40130-fukuoka-shi-2024

Dataset license metadata was read from the catalog's public `package_show` API on 2026-10-29: license ID `plateau`, title `PLATEAU Site Policy 「３．著作権について」に拠る`, license URL https://www.mlit.go.jp/plateau/site-policy/ . This is the specific dataset's declared policy, not an assumption that every PLATEAU dataset uses the same license. The site policy requires source attribution and disclosure of modifications; neither the source nor Fukuoka City endorses these simplified assets.

The online map defaults to the original physical-map core and allows westward panning; it must not fit every outlying recording into the initial view. Recording locations are requested at runtime through the restricted public catalog, never embedded into these assets. Google place coordinates are resolved in browser session memory, not written here.

Geometry generation for the west: use the city-model project's existing Python runtime with `scripts/prepare-sound-map-west.py --model-root <city-model-root> --output public/sound-map/fukuoka-west.json` from this audio repository. The source project remains read-only.
