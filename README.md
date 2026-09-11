# Person Card

A compact Home Assistant Lovelace chip for a `person.*` entity. Shows an
avatar, whether the person is home, and which device-tracker source last
placed them there (GPS / Bluetooth / Wi-Fi). Tapping it opens a built-in
detail popup — no separate popup card needed — listing every linked device
tracker plus, optionally, a colour-coded list of active severity alerts from
any set of sensors (pollen, air quality, anything with a numeric level).

## Installation

### HACS (custom repository)

1. HACS → the three-dot menu → Custom repositories.
2. Add `https://github.com/Gr33ndev/ha-person-card` with category
   **Lovelace**.
3. Install "Person Card", then hard-refresh your browser.

### Manual

1. Download `person-card.js` from the latest release.
2. Copy it into `config/www/`.
3. Add it as a dashboard resource: Settings → Dashboards → Resources →
   `/local/person-card.js`, type **JavaScript Module**.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `person_entity` | string | **required** | The `person.*` entity to show. |
| `name` | string | entity's friendly name | Override the displayed name. |
| `badge_entities` | list | `[]` | Entity IDs, or `{entity, name, icon}` objects, whose active severity levels drive the badge dot and the "Alerts" section of the popup. Detection order: a `numeric_state`/`level`/`pollen_level`/`index`/`value` attribute, or the primary state if it's a plain number. |
| `badge_max_level` | number | `4` | The top of the severity scale used for badge colours. |
| `disable_popup` | boolean | `false` | Open Home Assistant's native more-info dialog on tap instead of the built-in popup. |

```yaml
type: custom:person-card
person_entity: person.jane
badge_entities:
  - sensor.pollen_birch
  - sensor.pollen_ash
```

The badge dot stays hidden whenever no configured entity is currently above
level 0, or when `badge_entities` is omitted entirely.

### Device-tracker sources

The three source icons (GPS, Bluetooth, Wi-Fi) light up based on the
`device_trackers` attribute of the person entity: each tracker's
`source_type` attribute (`gps`, `bluetooth_le`/`bluetooth`, `router`) decides
which icon it feeds, and the icon is highlighted when that tracker's own
state is `home`. The same list, with per-tracker state and last-updated
time, appears in the popup.

## License

MIT — see [LICENSE](LICENSE).
