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

// Entities carrying a given Home Assistant Label (Settings > Entities > Label),
// resolved fresh from the entity registry on every call. Requires a frontend
// that exposes registry labels via hass.entities (2024.9+).
function entitiesWithLabel(hass, labelId) {
  if (!labelId || !hass.entities) return [];
  return Object.keys(hass.entities).filter((id) => (hass.entities[id].labels || []).includes(labelId));
}

function resolveBadgeCandidates(hass, cfg) {
  const candidates = [...cfg.badge_entities];
  if (cfg.badge_label) {
    const configured = new Set(candidates.map((item) => item.entity));
    for (const entityId of entitiesWithLabel(hass, cfg.badge_label)) {
      if (!configured.has(entityId)) candidates.push({ entity: entityId });
    }
  }
  return candidates;
}

function readActiveBadges(hass, entities, maxLevel) {
  const active = [];
  for (const item of entities) {
    // An entity gated by filter_entity/filter_state is only a candidate
    // while that other entity currently holds the given state — e.g. a
    // sensor that only matters while an input_select is set to this
    // person's name. Re-evaluated on every render, so reassigning the
    // selector elsewhere in HA updates the badge with no dashboard edit.
    if (item.filter_entity) {
      const filterState = hass.states[item.filter_entity];
      if (!filterState || filterState.state !== item.filter_state) continue;
    }
    const stateObj = hass.states[item.entity];
    if (!stateObj) continue;
    const level = readLevel(stateObj);
    if (level !== null && level > 0) {
      active.push({
        level,
        label: item.name || readLabel(stateObj),
        icon: item.icon || 'mdi:alert-circle',
        color: colorForLevel(level, maxLevel),
        entity: item.entity,
      });
    }
  }
  active.sort((a, b) => b.level - a.level || a.label.localeCompare(b.label));
  return active;
}

const TRACKER_TYPES = {
  gps: { icon: 'mdi:crosshairs-gps', label: 'GPS' },
  router: { icon: 'mdi:wifi', label: 'Wi-Fi' },
  bluetooth_le: { icon: 'mdi:bluetooth', label: 'Bluetooth' },
  bluetooth: { icon: 'mdi:bluetooth', label: 'Bluetooth' },
};

// Tracker type labels (GPS/Bluetooth/Wi-Fi) are standardized technical terms
// and stay untranslated; everything else the card writes to the DOM is
// looked up here, keyed by the frontend's current language.
const LOCALES = {
  en: {
    home: 'Home',
    away: 'Away',
    alerts: 'Alerts',
    locationSources: 'Location sources',
    noTrackers: 'No device trackers linked to this person.',
    noSource: 'no source',
    unknown: 'unknown',
    justNow: 'just now',
    secondsAgo: (n) => `${n}s ago`,
    minutesAgo: (n) => `${n}m ago`,
    hoursAgo: (n) => `${n}h ago`,
    daysAgo: (n) => `${n}d ago`,
  },
  de: {
    home: 'Zuhause',
    away: 'Abwesend',
    alerts: 'Warnungen',
    locationSources: 'Standortquellen',
    noTrackers: 'Keine Tracker mit dieser Person verknüpft.',
    noSource: 'keine Quelle',
    unknown: 'unbekannt',
    justNow: 'gerade eben',
    secondsAgo: (n) => `vor ${n}s`,
    minutesAgo: (n) => `vor ${n}m`,
    hoursAgo: (n) => `vor ${n}h`,
    daysAgo: (n) => `vor ${n}d`,
  },
};

function localeFor(hass) {
  const lang = (hass && (hass.locale?.language || hass.language) || 'en').split('-')[0];
  return LOCALES[lang] || LOCALES.en;
}

function relativeTime(iso, t) {
  if (!iso) return t.unknown;
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 5) return t.justNow;
  if (diffSec < 60) return t.secondsAgo(Math.floor(diffSec));
  if (diffSec < 3600) return t.minutesAgo(Math.floor(diffSec / 60));
  if (diffSec < 86400) return t.hoursAgo(Math.floor(diffSec / 3600));
  return t.daysAgo(Math.floor(diffSec / 86400));
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
        .badge-dot ha-icon {
          display: flex; align-items: center; justify-content: center;
          width: 9px; height: 9px;
          --mdc-icon-size: 9px; color: #fff;
        }

        .overlay {
          position: fixed; inset: 0; z-index: 10000;
          display: none; align-items: center; justify-content: center;
          background: rgba(0, 0, 0, 0.4);
          padding: 16px; box-sizing: border-box;
          cursor: default;
        }
        .overlay.open { display: flex; }
        .sheet {
          width: 100%; max-width: 400px; max-height: 80vh; overflow-y: auto;
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: 16px; padding: 16px 16px 20px;
          box-sizing: border-box; color: var(--primary-text-color);
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        }
        .sheet-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .sheet-header .name { font-size: 1.1rem; font-weight: 600; }
        .sheet-close {
          margin-left: auto; width: 28px; height: 28px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--secondary-background-color, rgba(127, 127, 127, 0.1));
          cursor: pointer; flex-shrink: 0;
        }
        .section-label {
          font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
          color: var(--secondary-text-color); margin: 12px 0 6px;
        }
        .section-label:first-of-type { margin-top: 0; }
        .row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 4px; border-radius: 10px;
        }
        .row-icon {
          width: 28px; height: 28px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--secondary-background-color, rgba(127, 127, 127, 0.1));
          flex-shrink: 0;
        }
        .row-icon ha-icon { --mdc-icon-size: 15px; }
        .row-icon.active { background: var(--state-person-home-color, #1c8331); }
        .row-icon.active ha-icon { color: #fff; }
        .row-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .row-name { font-size: 0.88rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row-meta { font-size: 0.75rem; color: var(--secondary-text-color); }
        .empty-note { font-size: 0.85rem; color: var(--secondary-text-color); padding: 4px; }
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
      </div>
      <div class="overlay">
        <div class="sheet">
          <div class="sheet-header">
            <ha-icon icon="mdi:account"></ha-icon>
            <span class="name"></span>
            <div class="sheet-close"><ha-icon icon="mdi:close"></ha-icon></div>
          </div>
          <div class="body"></div>
        </div>
      </div>`;
    this._el = {
      chip: this.shadowRoot.querySelector('.chip'),
      img: this.shadowRoot.querySelector('.avatar img'),
      icon: this.shadowRoot.querySelector('.avatar ha-icon'),
      name: this.shadowRoot.querySelector('.chip .name'),
      gps: this.shadowRoot.querySelector('.gps'),
      ble: this.shadowRoot.querySelector('.ble'),
      wifi: this.shadowRoot.querySelector('.wifi'),
      badgeDot: this.shadowRoot.querySelector('.badge-dot'),
      badgeIcon: this.shadowRoot.querySelector('.badge-dot ha-icon'),
      overlay: this.shadowRoot.querySelector('.overlay'),
      sheetName: this.shadowRoot.querySelector('.sheet-header .name'),
      body: this.shadowRoot.querySelector('.body'),
    };
    this._el.chip.addEventListener('click', () => {
      if (this._config.disable_popup) {
        this.dispatchEvent(
          new CustomEvent('hass-more-info', {
            detail: { entityId: this._config.person_entity },
            bubbles: true,
            composed: true,
          })
        );
      } else {
        this._el.overlay.classList.add('open');
        this._renderOverlay();
      }
    });
    this._el.overlay.addEventListener('click', (e) => {
      if (e.target === this._el.overlay) this._el.overlay.classList.remove('open');
    });
    this._el.overlay
      .querySelector('.sheet-close')
      .addEventListener('click', () => this._el.overlay.classList.remove('open'));
  }

  _renderOverlay() {
    const cfg = this._config;
    const hass = this._hass;
    const t = localeFor(hass);
    const personState = hass.states[cfg.person_entity];
    if (!personState) return;

    this._el.sheetName.textContent = cfg.name || personState.attributes.friendly_name || cfg.person_entity;
    this._el.body.innerHTML = '';

    const badgeCandidates = resolveBadgeCandidates(hass, cfg);
    const badges = badgeCandidates.length ? readActiveBadges(hass, badgeCandidates, cfg.badge_max_level) : [];
    if (badges.length) {
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = t.alerts;
      this._el.body.appendChild(label);
      badges.forEach((badge) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `
          <div class="row-icon" style="background:${badge.color}"><ha-icon icon="${badge.icon}" style="color:#fff"></ha-icon></div>
          <div class="row-info"><div class="row-name">${badge.label}</div></div>`;
        row.addEventListener('click', () =>
          row.dispatchEvent(
            new CustomEvent('hass-more-info', { detail: { entityId: badge.entity }, bubbles: true, composed: true })
          )
        );
        this._el.body.appendChild(row);
      });
    }

    const trackerLabel = document.createElement('div');
    trackerLabel.className = 'section-label';
    trackerLabel.textContent = t.locationSources;
    this._el.body.appendChild(trackerLabel);

    const trackers = personState.attributes.device_trackers || [];
    if (!trackers.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-note';
      empty.textContent = t.noTrackers;
      this._el.body.appendChild(empty);
    }
    trackers.forEach((entityId) => {
      const ts = hass.states[entityId];
      if (!ts) return;
      const meta = TRACKER_TYPES[ts.attributes.source_type] || { icon: 'mdi:help-circle-outline', label: ts.attributes.source_type || 'Unknown' };
      const active = ts.state === 'home';
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div class="row-icon${active ? ' active' : ''}"><ha-icon icon="${meta.icon}"></ha-icon></div>
        <div class="row-info">
          <div class="row-name">${meta.label} &middot; ${ts.attributes.friendly_name || entityId}</div>
          <div class="row-meta">${active ? t.home : ts.state === 'not_home' ? t.away : ts.state} &middot; ${relativeTime(ts.last_updated, t)}</div>
        </div>`;
      row.addEventListener('click', () =>
        row.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }))
      );
      this._el.body.appendChild(row);
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
    const t = localeFor(hass);

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
      trackers.map((entId) => hass.states[entId]).find((ts) => ts && types.includes(ts.attributes.source_type));

    const gpsTs = findTracker(['gps']);
    const bleTs = findTracker(['bluetooth_le', 'bluetooth']);
    const wifiTs = findTracker(['router']);

    const setSrc = (key, ts, label) => {
      const active = ts && ts.state === 'home';
      this._el[key].classList.toggle('active', !!active);
      this._el[key].title = ts ? `${label}: ${ts.state}` : `${label}: ${t.noSource}`;
    };
    setSrc('gps', gpsTs, 'GPS');
    setSrc('ble', bleTs, 'Bluetooth');
    setSrc('wifi', wifiTs, 'Wi-Fi');

    const badgeCandidates = resolveBadgeCandidates(hass, cfg);
    if (badgeCandidates.length) {
      const worst = readActiveBadges(hass, badgeCandidates, cfg.badge_max_level)[0];
      if (worst) {
        this._el.badgeDot.style.display = 'flex';
        this._el.badgeDot.style.background = worst.color;
        this._el.badgeDot.title = worst.label;
        this._el.badgeIcon.setAttribute('icon', worst.icon);
      } else {
        this._el.badgeDot.style.display = 'none';
      }
    } else {
      this._el.badgeDot.style.display = 'none';
    }

    if (this._el.overlay.classList.contains('open')) {
      this._renderOverlay();
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
  description: 'Compact avatar chip showing a person\'s home/away state and device-tracker sources, with a built-in detail popup (location sources plus an optional severity badge from any set of sensors) — no separate popup card needed.',
});
