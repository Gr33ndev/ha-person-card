const LEVEL_COLORS = ['#9e9e9e', '#4caf50', '#ffc107', '#fb8c00', '#e53935'];

// Same detection order as pollen-card: works with any sensor that exposes a
// numeric severity level, either as an attribute or as its primary state.
function readLevel(stateObj) {
  const attrs = stateObj.attributes || {};
  const numericKeys = ['numeric_state', 'level', 'pollen_level', 'index', 'value'];
  for (const key of numericKeys) {
    const raw = attrs[key];
    if (raw !== undefined && raw !== null && raw !== '' && !Number.isNaN(Number(raw))) {
      return Number(raw);
    }
  }
  if (!Number.isNaN(Number(stateObj.state))) {
    return Number(stateObj.state);
  }
  return null;
}

function readLabel(stateObj) {
  const attrs = stateObj.attributes || {};
  const textKeys = ['named_state', 'level_name', 'state_text'];
  for (const key of textKeys) {
    if (attrs[key]) return attrs[key];
  }
  return attrs.friendly_name || stateObj.entity_id;
}

function colorForLevel(level, maxLevel) {
  if (level === null || level === undefined || Number.isNaN(level)) return LEVEL_COLORS[0];
  const ratio = maxLevel > 0 ? level / maxLevel : 0;
  const index = Math.max(0, Math.min(LEVEL_COLORS.length - 1, Math.round(ratio * (LEVEL_COLORS.length - 1))));
  return LEVEL_COLORS[index];
}

function normalizeEntities(list) {
  return (list || []).map((item) => (typeof item === 'string' ? { entity: item } : item));
}

function findWorstBadge(hass, entities) {
  let worst = null;
  for (const item of entities) {
    const stateObj = hass.states[item.entity];
    if (!stateObj) continue;
    const level = readLevel(stateObj);
    if (level !== null && level > 0 && (!worst || level > worst.level)) {
      worst = { level, label: readLabel(stateObj), entity: item.entity };
    }
  }
  return worst;
}

class PersonCard extends HTMLElement {
  setConfig(config) {
    if (!config.person_entity) throw new Error('person_entity is required');
    this._config = {
      badge_max_level: 4,
      ...config,
      badge_entities: normalizeEntities(config.badge_entities),
    };
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  _buildDom() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-flex; cursor: pointer; }
        .chip {
          position: relative;
          display: flex; align-items: center; gap: 6px;
          padding: 4px 10px 4px 4px; border-radius: 999px;
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border: 1px solid var(--divider-color, #e0e0e0);
          font-size: 12px; color: var(--primary-text-color);
          box-sizing: border-box;
        }
        .avatar {
          width: 24px; height: 24px; border-radius: 50%;
          background: var(--state-inactive-color, #9e9e9e);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; flex-shrink: 0;
        }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }
        .avatar ha-icon { --mdc-icon-size: 16px; color: white; }
        .chip.home .avatar { background: var(--state-person-home-color, #1c8331); }
        .name { font-weight: 500; white-space: nowrap; }
        .sources { display: flex; gap: 3px; margin-left: 2px; }
        .src { --mdc-icon-size: 14px; color: var(--disabled-text-color, #bdbdbd); }
        .src.active { color: var(--state-person-home-color, #1c8331); }
        .badge-dot {
          position: absolute; top: -4px; right: -4px;
          width: 14px; height: 14px; border-radius: 50%;
          display: none; align-items: center; justify-content: center;
          box-shadow: 0 0 0 2px var(--card-background-color, #fff);
        }
        .badge-dot ha-icon { --mdc-icon-size: 9px; color: #fff; }
      </style>
      <div class="chip">
        <div class="avatar"><img hidden><ha-icon icon="mdi:account"></ha-icon></div>
        <span class="name"></span>
        <span class="sources">
          <ha-icon class="src gps" icon="mdi:crosshairs-gps"></ha-icon>
          <ha-icon class="src ble" icon="mdi:bluetooth"></ha-icon>
          <ha-icon class="src wifi" icon="mdi:wifi"></ha-icon>
        </span>
        <div class="badge-dot"><ha-icon icon="mdi:alert-circle"></ha-icon></div>
      </div>`;
    this._el = {
      chip: this.shadowRoot.querySelector('.chip'),
      img: this.shadowRoot.querySelector('.avatar img'),
      icon: this.shadowRoot.querySelector('.avatar ha-icon'),
      name: this.shadowRoot.querySelector('.name'),
      gps: this.shadowRoot.querySelector('.gps'),
      ble: this.shadowRoot.querySelector('.ble'),
      wifi: this.shadowRoot.querySelector('.wifi'),
      badgeDot: this.shadowRoot.querySelector('.badge-dot'),
      badgeIcon: this.shadowRoot.querySelector('.badge-dot ha-icon'),
    };
    this._el.chip.addEventListener('click', () => {
      const cfg = this._config;
      if (cfg.popup_hash) {
        if (location.hash === cfg.popup_hash) {
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          location.hash = cfg.popup_hash;
        }
      } else {
        this.dispatchEvent(
          new CustomEvent('hass-more-info', {
            detail: { entityId: cfg.person_entity },
            bubbles: true,
            composed: true,
          })
        );
      }
    });
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) {
      this._buildDom();
      this._built = true;
    }
    const cfg = this._config;
    const hass = this._hass;

    const personState = hass.states[cfg.person_entity];
    const isHome = personState && personState.state === 'home';
    this._el.chip.classList.toggle('home', !!isHome);
    this._el.name.textContent =
      cfg.name || (personState && personState.attributes.friendly_name) || cfg.person_entity;

    const pic = personState && personState.attributes.entity_picture;
    if (pic) {
      this._el.img.src = hass.hassUrl ? hass.hassUrl(pic) : pic;
      this._el.img.hidden = false;
      this._el.icon.style.display = 'none';
    } else {
      this._el.img.hidden = true;
      this._el.icon.style.display = '';
    }

    const trackers = (personState && personState.attributes.device_trackers) || [];
    const findTracker = (types) =>
      trackers.map((t) => hass.states[t]).find((ts) => ts && types.includes(ts.attributes.source_type));

    const gpsTs = findTracker(['gps']);
    const bleTs = findTracker(['bluetooth_le', 'bluetooth']);
    const wifiTs = findTracker(['router']);

    const setSrc = (key, ts, label) => {
      const active = ts && ts.state === 'home';
      this._el[key].classList.toggle('active', !!active);
      this._el[key].title = ts ? `${label}: ${ts.state}` : `${label}: no source`;
    };
    setSrc('gps', gpsTs, 'GPS');
    setSrc('ble', bleTs, 'Bluetooth');
    setSrc('wifi', wifiTs, 'Wi-Fi');

    if (cfg.badge_entities.length) {
      const worst = findWorstBadge(hass, cfg.badge_entities);
      if (worst) {
        this._el.badgeDot.style.display = 'flex';
        this._el.badgeDot.style.background = colorForLevel(worst.level, cfg.badge_max_level);
        this._el.badgeDot.title = worst.label;
        if (cfg.badge_icon) this._el.badgeIcon.setAttribute('icon', cfg.badge_icon);
      } else {
        this._el.badgeDot.style.display = 'none';
      }
    } else {
      this._el.badgeDot.style.display = 'none';
    }
  }

  static getStubConfig(hass) {
    const person = Object.keys(hass.states).find((id) => id.startsWith('person.'));
    return { person_entity: person || 'person.example' };
  }
}

customElements.define('person-card', PersonCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'person-card',
  name: 'Person Card',
  description: 'Compact avatar chip showing a person\'s home/away state, which device-tracker source last reported them home (GPS/Bluetooth/Wi-Fi), and an optional severity badge from any set of sensors.',
});
