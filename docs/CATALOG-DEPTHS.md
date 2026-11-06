# Catalog depths

Depth-fit warns when gear is deeper than its rack, or when front and rear gear
sharing a U don't fit the rack's depth together. It can only judge a unit that
records a depth. The hardware catalog in
[`src/rack/rackCatalog.ts`](../src/rack/rackCatalog.ts) supplies one for each model
it knows, so a model applied in the inspector, pasted in a parts list or placed
from a rack template arrives with its depth.

## How depth is measured

Vendors measure depth differently. Some include the bezel, the PSU handles or the
cable brackets, and some don't. NexMap records one figure per model, the
**installed depth**:

- **Measured** from the front face to the rearmost fixed part.
- **Includes** the power supplies and fans.
- **Excludes** the bezel and the cable-management brackets.

Where a datasheet gives several figures, the one closest to that rule is used.
Figures are rounded to the nearest millimetre, and inches are converted at 25.4 mm.

A model is left without a depth when no trustworthy figure was found, rather than
given a guess. A unit without a depth is simply not judged, and the rack insights
say so ("Depth not checked for N units").

## Figures and sources

Checked November 2026. Each entry is the vendor's datasheet or hardware guide
unless it says otherwise.

| Model | Depth (mm) | Notes | Source |
| --- | --- | --- | --- |
| Cisco Catalyst 9300-24T | 449 | With the default PSU. The chassis alone is 409 mm, and 488 mm with the 1100 W PSU. | [Cisco data sheet](https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html) |
| Cisco Catalyst 9300-48P | 449 | As the 9300-24T. | same |
| Cisco Nexus 9336C-FX2 | 622 | 24.5 in. | [Cisco data sheet](https://www.cisco.com/c/en/us/products/collateral/switches/nexus-9000-series-switches/datasheet-c78-742282.html) |
| Arista 7050SX3-48YC8 | 468 | 18.4 in. | [Arista data sheet](https://www.arista.com/assets/data/pdf/Datasheets/7050X3-Datasheet.pdf) |
| Juniper EX4300-48T | 445 | Including FRUs (PSUs and fans). The chassis alone is 416 mm. | [Juniper HCT](https://apps.juniper.net/hct/product/EX4300/hwspecs) |
| Ubiquiti USW-Pro-48 | 285 | The non-PoE model. The PoE model is about 400 mm. | [Ubiquiti tech specs](https://techspecs.ui.com/unifi/switching/usw-pro-48) |
| HPE Aruba 6300M 48G | 385 | JL663A. | [HPE install guide](https://support.hpe.com/hpesc/public/api/document/a00073540enw) |
| Netgear GS724T | 169 | GS724Tv6. Rack-mounts with brackets. | [Netgear data sheet](https://www.downloads.netgear.com/files/GDC/GS724Tv6/GS724Tv6_DS.pdf) |
| Cisco ISR 4331 | 438 | 17.25 in. | [Cisco data sheet](https://www.cisco.com/c/en/us/products/collateral/routers/4000-series-integrated-services-routers-isr/data_sheet-c78-732542.html) |
| Cisco ASR 1001-X | 462 | Excluding handles and cable brackets. | [Cisco data sheet](https://www.cisco.com/c/en/us/products/collateral/routers/asr-1000-series-aggregation-services-routers/datasheet-c78-731632.html) |
| Juniper MX204 | 519 | Including FRUs. The chassis alone is 470 mm. | [Juniper HCT](https://apps.juniper.net/hct/product/MX204/hwspecs) |
| MikroTik CCR2004-16G | 210 | CCR2004-16G-2S+. | [MikroTik](https://mikrotik.com/product/ccr2004_16g_2splus) |
| Palo Alto PA-3220 | 522 | Including rear protrusions. | [Palo Alto docs](https://docs.paloaltonetworks.com/hardware/pa-3200-hardware-reference/pa-3200-series-specifications/physical-specs-pa-3200-series) |
| Fortinet FortiGate 100F | 254 | Distributor figure, because the datasheet PDF would not load. | [Distributor](https://datacenter360.ca/fortinet/fortigate/fortigate-100f-firewall/) |
| Cisco Firepower 1140 | 269 | 10.58 in. | [Cisco data sheet](https://www.cisco.com/c/en/us/products/collateral/security/firepower-1000-series/datasheet-c78-742469.html) |
| Netgate 6100 | 254 | A desktop unit. This is its depth in Netgate's 1U rack kit. | [Netgate rack kit](https://shop.netgate.com/products/4100-6100-1u-rack-mount-kit) |
| F5 BIG-IP i2800 | 572 | 22.5 in. | [F5 platform guide](https://techdocs.f5.com/en-us/hw-platforms/platform-guide-i2000i4000-series/title--platform-specifications.html) |
| Cisco Catalyst 9800-40 | 495 | 19.5 in. | [Cisco data sheet](https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9800-series-wireless-controllers/nb-06-cat9800-wirel-cont-data-sheet-ctp-en.html) |
| Dell PowerEdge R650 | 758 | The 8 × 2.5" chassis, without bezel. The 10 × 2.5" and 4 × 3.5" chassis are 809 mm. | [Dell owner's manual](https://dl.dell.com/topicspdf/poweredge-r650_Owners-Manual2_en-us.pdf) |
| Dell PowerEdge R750 | 758 | Without bezel. All drive configurations. | [Dell spec sheet](https://www.delltechnologies.com/asset/en-us/products/servers/technical-support/dell-emc-poweredge-r750-spec-sheet.pdf) |
| HPE ProLiant DL360 Gen11 | 753 | 8+2 SFF. The LFF and EDSFF models are 773 mm. | [HPE QuickSpecs](https://support.hpe.com/hpesc/public/api/document/a50004306enw) |
| HPE ProLiant DL380 Gen11 | 727 | SFF. The LFF model is 733 mm. | [HPE QuickSpecs](https://support.hpe.com/hpesc/public/api/document/a50004307enw) |
| Supermicro SYS-1029U | 724 | SYS-1029U-TR4. | [Supermicro](https://www.supermicro.com/en/products/system/1u/1029/sys-1029u-tr4.php) |
| Lenovo ThinkSystem SR650 | 764 | Without bezel, including the PSU handle. | [Lenovo Press](https://lenovopress.lenovo.com/lp1050-thinksystem-sr650-server) |
| Synology RS3621xs+ | 724 | | [Synology spec](https://global.download.synology.com/download/Document/Hardware/ProductSpec/RackStation/21-year/RS3621xs%2B/enu/Product_Spec_RS3621xs%2B_enu.pdf) |
| Dell PowerVault ME5024 | 548 | The sheet prints "54.78mm", a unit typo for 21.56 in. | [Dell spec sheet](https://www.delltechnologies.com/asset/en-us/products/storage/technical-support/dell-powervault-me5-ss.pdf) |
| NetApp FAS2750 | 483 | 612 mm with the cable-management bracket. | [NetApp docs](https://docs.netapp.com/us-en/ontap-systems/fas2700/overview.html) |
| APC Smart-UPS SRT 2200 | 584 | SRT2200RMXLI. | [APC datasheet (distributor copy)](https://media.mmem.com.au/Datasheets/APC/APC_SRT2200RMXLI.pdf) |
| Eaton 5PX 3000 | 648 | 5PX3000RT2U, Gen 1. | [Eaton datasheet (distributor copy)](https://www.elliottelectric.com/Media/5PX3000RT2U-EPQ-1021-3-Attachment.pdf) |
| CyberPower OR1500LCDRM1U | 389 | | [CyberPower](https://www.cyberpowersystems.com/product/ups/smart-app-online/or1500lcdrm1u/) |
| Panduit 24-port Cat6 patch | 30 | DP24688TGY, panel body only. Distributor figure. | [Distributor](https://www.gerrie.com/Product/Panduit-DP24688TGY) |
| Panduit 48-port Cat6 patch | — | The sourced part is 2U, so it doesn't match this 1U entry. | — |

## Adding a model

Add `depthMm` from the vendor's datasheet, measured as above, and add a row to
this table with the source. Leave it out rather than estimate.
