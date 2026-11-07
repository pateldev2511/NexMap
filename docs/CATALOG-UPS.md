# Catalog UPS output ratings

`CatalogModel.outputW` is a UPS's output rating in **watts**, not VA. It sets
`Device.ratedWatts`, which the feed-backing check compares against the load on the
feed the UPS backs. A rating is filled in only where the catalog's model name pins
down one variant. Otherwise it is left out rather than guessed.

| Catalog id | Model | Output | Source |
| --- | --- | --- | --- |
| `eaton-5px3000` | Eaton 5PX 3000 | 2700 W (3000 VA, PF 0.9) | [Eaton SKU page, 5PX3000IRT2U](https://www.eaton.com/tw/zh-tw/skuPage.5PX3000IRT2U.html) |
| `cyberpower-or1500` | CyberPower OR1500LCDRM1U | 900 W (1500 VA) | [Manufacturer brochure via Etilize](https://content.etilize.com/Manufacturer-Brochure/1012135961.pdf) |
| `cyberpower-or600` | CyberPower OR600ERM1U | 360 W (600 VA) | [CyberPower product page](https://www.cyberpower.com/eu/hr/product/sku/or600erm1u) |

Left out:

- `apc-srt2200` (APC Smart-UPS SRT 2200). The 120 V model (SRT2200RMXLA) is rated
  1800 W and the 230 V model (SRT2200RMXLI) 1980 W; the catalog name doesn't say which.
- The Eaton 5PX **G2** 3000 is rated 3000 W. That is a different model name, so it
  doesn't take the 5PX 3000's figure.
