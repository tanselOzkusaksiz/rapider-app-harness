/**
 * Rapider Shared International Phone Input Component
 * Compatible with all Rapider application themes (Tailwind CSS, light & dark modes).
 * Supports country selection with country code, flags, country masks (via IMask),
 * and a "Custom" option for freeform/unmasked international inputs.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RapiderPhoneInput = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COUNTRIES = [
    { code: 'CUSTOM', name: 'Custom (No Mask)', dial: '', flag: '🌐', mask: null, placeholder: 'Enter phone number...' },
    { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸', mask: '(000) 000-0000', placeholder: '(555) 012-3456' },
    { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦', mask: '(000) 000-0000', placeholder: '(555) 012-3456' },
    { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', mask: '0000 000000', placeholder: '7911 123456' },
    { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪', mask: '0000 0000000', placeholder: '1512 3456789' },
    { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷', mask: '0 00 00 00 00', placeholder: '6 12 34 56 78' },
    { code: 'TR', name: 'Turkey', dial: '+90', flag: '🇹🇷', mask: '(000) 000 00 00', placeholder: '(532) 123 45 67' },
    { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', mask: '0000 000 000', placeholder: '0412 345 678' },
    { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', mask: '00000 00000', placeholder: '98765 43210' },
    { code: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵', mask: '00-0000-0000', placeholder: '90-1234-5678' },
    { code: 'CN', name: 'China', dial: '+86', flag: '🇨🇳', mask: '000 0000 0000', placeholder: '138 0013 8000' },
    { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷', mask: '(00) 00000-0000', placeholder: '(11) 98765-4321' },
    { code: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽', mask: '000 000 0000', placeholder: '55 1234 5678' },
    { code: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸', mask: '000 00 00 00', placeholder: '612 34 56 78' },
    { code: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹', mask: '000 000 0000', placeholder: '320 123 4567' },
    { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱', mask: '0 0000 0000', placeholder: '6 1234 5678' },
    { code: 'CH', name: 'Switzerland', dial: '+41', flag: '🇨🇭', mask: '00 000 00 00', placeholder: '79 123 45 67' },
    { code: 'SE', name: 'Sweden', dial: '+46', flag: '🇸🇪', mask: '00-000 00 00', placeholder: '70-123 45 67' },
    { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪', mask: '00 000 0000', placeholder: '50 123 4567' },
    { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦', mask: '00 000 0000', placeholder: '50 123 4567' },
    { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', mask: '0000 0000', placeholder: '9123 4567' },
    { code: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦', mask: '00 000 0000', placeholder: '71 123 4567' },
    { code: 'NZ', name: 'New Zealand', dial: '+64', flag: '🇳🇿', mask: '000 000 0000', placeholder: '021 123 4567' },
    { code: 'KR', name: 'South Korea', dial: '+82', flag: '🇰🇷', mask: '00-0000-0000', placeholder: '10-1234-5678' },
    { code: 'PL', name: 'Poland', dial: '+48', flag: '🇵🇱', mask: '000 000 000', placeholder: '512 345 678' },
    { code: 'IE', name: 'Ireland', dial: '+353', flag: '🇮🇪', mask: '00 000 0000', placeholder: '87 123 4567' },
    { code: 'BE', name: 'Belgium', dial: '+32', flag: '🇧🇪', mask: '000 00 00 00', placeholder: '470 12 34 56' },
    { code: 'AT', name: 'Austria', dial: '+43', flag: '🇦🇹', mask: '0000 000000', placeholder: '664 123456' },
    { code: 'DK', name: 'Denmark', dial: '+45', flag: '🇩🇰', mask: '00 00 00 00', placeholder: '20 12 34 56' },
    { code: 'NO', name: 'Norway', dial: '+47', flag: '🇳🇴', mask: '000 00 000', placeholder: '912 34 567' },
    { code: 'FI', name: 'Finland', dial: '+358', flag: '🇫🇮', mask: '00 000 0000', placeholder: '40 123 4567' },
    { code: 'PT', name: 'Portugal', dial: '+351', flag: '🇵🇹', mask: '000 000 000', placeholder: '912 345 678' },
    { code: 'GR', name: 'Greece', dial: '+30', flag: '🇬🇷', mask: '000 000 0000', placeholder: '691 234 5678' },
    { code: 'IL', name: 'Israel', dial: '+972', flag: '🇮🇱', mask: '00-000-0000', placeholder: '50-123-4567' },
    { code: 'AR', name: 'Argentina', dial: '+54', flag: '🇦🇷', mask: '00 0000-0000', placeholder: '11 1234-5678' },
    { code: 'CO', name: 'Colombia', dial: '+57', flag: '🇨🇴', mask: '000 000 0000', placeholder: '300 123 4567' },
    { code: 'CL', name: 'Chile', dial: '+56', flag: '🇨🇱', mask: '0 0000 0000', placeholder: '9 1234 5678' },
    { code: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭', mask: '000 000 0000', placeholder: '917 123 4567' },
    { code: 'PK', name: 'Pakistan', dial: '+92', flag: '🇵🇰', mask: '000 0000000', placeholder: '300 1234567' },
    { code: 'ID', name: 'Indonesia', dial: '+62', flag: '🇮🇩', mask: '000-0000-0000', placeholder: '812-3456-7890' },
    { code: 'MY', name: 'Malaysia', dial: '+60', flag: '🇲🇾', mask: '00-000 0000', placeholder: '12-345 6789' },
    { code: 'TH', name: 'Thailand', dial: '+66', flag: '🇹🇭', mask: '00 000 0000', placeholder: '81 234 5678' },
    { code: 'VN', name: 'Vietnam', dial: '+84', flag: '🇻🇳', mask: '000 000 0000', placeholder: '912 345 678' },
    { code: 'EG', name: 'Egypt', dial: '+20', flag: '🇪🇬', mask: '00 0000 0000', placeholder: '10 1234 5678' },
    { code: 'NG', name: 'Nigeria', dial: '+234', flag: '🇳🇬', mask: '000 000 0000', placeholder: '802 123 4567' }
  ];

  // Lookup map by country code
  const COUNTRY_MAP = {};
  COUNTRIES.forEach(c => { COUNTRY_MAP[c.code] = c; });

  // Sorted dial codes for prefix matching (longest dial code first to avoid ambiguous prefixes like +1 vs +1246)
  const DIAL_CODES_SORTED = COUNTRIES
    .filter(c => c.dial)
    .sort((a, b) => b.dial.length - a.dial.length);

  /**
   * Core Phone Input Controller
   */
  class PhoneInputController {
    constructor(container, options = {}) {
      this.container = container;
      this.options = Object.assign({
        defaultCountry: 'US',
        placeholder: null,
        initialValue: '',
        name: null,
        id: null,
        required: false,
        disabled: false
      }, options);

      this.currentCountry = COUNTRY_MAP[this.options.defaultCountry] || COUNTRY_MAP['US'];
      this.maskInstance = null;
      this._value = '';
      this._isSettingValue = false;

      this.render();
      this.bindEvents();

      if (this.options.initialValue) {
        this.setValue(this.options.initialValue);
      }
    }

    render() {
      this.container.classList.add(
        'rapider-phone-container',
        'flex',
        'items-stretch',
        'w-full',
        'rounded-lg',
        'bg-alt-background',
        'border',
        'border-secondary-border',
        'focus-within:border-primary',
        'focus-within:ring-1',
        'focus-within:ring-primary',
        'transition-all',
        'overflow-hidden'
      );

      // 1. Country Selector dropdown container
      const countryWrapper = document.createElement('div');
      countryWrapper.className = 'relative flex items-center border-r border-secondary-border shrink-0 bg-component-inner/30 hover:bg-component-inner/60 transition-colors';

      const select = document.createElement('select');
      select.className = 'rapider-phone-country appearance-none bg-transparent pl-3 pr-7 py-2 text-sm font-medium text-primary-text cursor-pointer focus:outline-none select-none';
      select.setAttribute('aria-label', 'Select Country Code');

      COUNTRIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.code;
        opt.className = 'bg-component-inner text-primary-text py-1.5';
        if (c.code === 'CUSTOM') {
          opt.textContent = `${c.flag} Custom`;
          opt.title = 'Custom / Freeform (No Mask)';
        } else {
          opt.textContent = `${c.flag} ${c.dial} (${c.code})`;
          opt.title = `${c.name} (${c.dial})`;
        }
        if (c.code === this.currentCountry.code) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      const chevron = document.createElement('i');
      chevron.className = 'fas fa-chevron-down absolute right-2.5 text-[10px] text-secondary-text pointer-events-none transition-transform';

      countryWrapper.appendChild(select);
      countryWrapper.appendChild(chevron);

      // 2. Text Input for phone number
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'rapider-phone-number flex-1 px-3.5 py-2 bg-transparent text-sm text-primary-text placeholder:text-secondary-text/50 focus:outline-none min-w-0';
      input.placeholder = this.currentCountry.placeholder || 'Enter phone number...';
      if (this.options.name) input.name = this.options.name;
      if (this.options.required) input.required = true;
      if (this.options.disabled) {
        input.disabled = true;
        select.disabled = true;
        this.container.classList.add('opacity-60', 'cursor-not-allowed');
      }

      this.container.innerHTML = '';
      this.container.appendChild(countryWrapper);
      this.container.appendChild(input);

      this.countrySelect = select;
      this.phoneInput = input;

      this.applyMask();
    }

    applyMask() {
      // Clean up previous mask instance
      if (this.maskInstance) {
        try { this.maskInstance.destroy(); } catch (e) {}
        this.maskInstance = null;
      }

      if (this.currentCountry.code === 'CUSTOM' || !this.currentCountry.mask) {
        // Freeform Custom Mode: No IMask, allow user to type anything
        this.phoneInput.placeholder = this.options.placeholder || 'Enter phone number freely...';
      } else {
        // Country Mask Mode
        this.phoneInput.placeholder = this.options.placeholder || this.currentCountry.placeholder;
        if (typeof window.IMask === 'function') {
          this.maskInstance = window.IMask(this.phoneInput, {
            mask: this.currentCountry.mask
          });
        }
      }
    }

    bindEvents() {
      // Country Change
      this.countrySelect.addEventListener('change', () => {
        const newCode = this.countrySelect.value;
        const newCountry = COUNTRY_MAP[newCode] || COUNTRY_MAP['CUSTOM'];
        this.currentCountry = newCountry;

        // Preserve raw digits or text
        const currentRaw = this.phoneInput.value;
        this.applyMask();

        if (currentRaw) {
          if (this.maskInstance) {
            // Filter digits only for country masks
            const digits = currentRaw.replace(/\D/g, '');
            this.maskInstance.value = digits;
          } else {
            this.phoneInput.value = currentRaw;
          }
        }

        this.updateValue();
        this.phoneInput.focus();
      });

      // Phone Input input/change
      const handleInput = () => {
        this.updateValue();
      };
      this.phoneInput.addEventListener('input', handleInput);
      this.phoneInput.addEventListener('change', handleInput);
    }

    updateValue() {
      const rawNumber = this.phoneInput.value.trim();
      let combined = '';

      if (!rawNumber) {
        combined = '';
      } else if (this.currentCountry.code === 'CUSTOM' || !this.currentCountry.dial) {
        combined = rawNumber;
      } else {
        // Ensure dial code is prefixed cleanly
        if (rawNumber.startsWith('+')) {
          combined = rawNumber;
        } else {
          combined = `${this.currentCountry.dial} ${rawNumber}`;
        }
      }

      this._value = combined;

      // Dispatch unified event
      const event = new CustomEvent('rapider-phone-change', {
        bubbles: true,
        detail: {
          value: combined,
          country: this.currentCountry.code,
          dialCode: this.currentCountry.dial,
          localNumber: rawNumber
        }
      });
      this.container.dispatchEvent(event);

      // Also trigger standard input on container for form serialization
      this.container.dispatchEvent(new Event('input', { bubbles: true }));
      this.container.dispatchEvent(new Event('change', { bubbles: true }));
    }

    getValue() {
      return this._value || '';
    }

    setValue(val) {
      if (this._isSettingValue) return;
      this._isSettingValue = true;

      const strVal = (val || '').trim();
      if (!strVal) {
        if (this.maskInstance) this.maskInstance.value = '';
        this.phoneInput.value = '';
        this._value = '';
        this._isSettingValue = false;
        return;
      }

      // Try to detect country from dial code (e.g. +90 532 123 4567, +1 (555)...)
      let matchedCountry = null;
      let localPart = strVal;

      if (strVal.startsWith('+')) {
        for (const c of DIAL_CODES_SORTED) {
          if (strVal.startsWith(c.dial)) {
            matchedCountry = c;
            localPart = strVal.slice(c.dial.length).trim();
            break;
          }
        }
      }

      if (matchedCountry) {
        this.currentCountry = matchedCountry;
        this.countrySelect.value = matchedCountry.code;
        this.applyMask();
        if (this.maskInstance) {
          this.maskInstance.value = localPart;
        } else {
          this.phoneInput.value = localPart;
        }
      } else {
        // Could not match international dial code or custom text: set to CUSTOM
        this.currentCountry = COUNTRY_MAP['CUSTOM'];
        this.countrySelect.value = 'CUSTOM';
        this.applyMask();
        this.phoneInput.value = strVal;
      }

      this.updateValue();
      this._isSettingValue = false;
    }
  }

  /**
   * Helper function: attach to an existing <input> or container
   * Replaces or wraps the input with the stylish country dropdown + masked field,
   * while ensuring document.getElementById(originalId).value continues to return the full international number!
   */
  function attach(targetElement, options = {}) {
    if (!targetElement) return null;

    if (typeof targetElement === 'string') {
      targetElement = document.querySelector(targetElement);
    }
    if (!targetElement) return null;

    // If it's already an instance
    if (targetElement.__rapiderPhoneCtrl) {
      return targetElement.__rapiderPhoneCtrl;
    }

    let wrapper;
    let originalId = targetElement.id || options.id;
    let originalName = targetElement.name || options.name;
    let initialVal = options.initialValue || targetElement.value || '';
    let required = targetElement.required || options.required || false;
    let disabled = targetElement.disabled || options.disabled || false;

    if (targetElement.tagName.toLowerCase() === 'input') {
      wrapper = document.createElement('div');
      targetElement.parentNode.insertBefore(wrapper, targetElement);
      targetElement.style.display = 'none'; // hide original, keep for form serialization
      wrapper.appendChild(targetElement);
    } else {
      wrapper = targetElement;
    }

    const ctrl = new PhoneInputController(wrapper, {
      id: originalId,
      name: originalName,
      initialValue: initialVal,
      required: required,
      disabled: disabled,
      defaultCountry: options.defaultCountry || 'US',
      placeholder: options.placeholder
    });

    // Keep original element value synchronized
    if (targetElement.tagName.toLowerCase() === 'input') {
      wrapper.addEventListener('rapider-phone-change', (e) => {
        targetElement.value = e.detail.value;
      });

      // Define property getter/setter on targetElement for backward compatibility
      Object.defineProperty(targetElement, 'rapiderValue', {
        get: () => ctrl.getValue(),
        set: (v) => ctrl.setValue(v),
        configurable: true
      });

      // Proxy .value so document.getElementById('...').value returns full formatted number
      const originalValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      Object.defineProperty(targetElement, 'value', {
        get: function () {
          return ctrl.getValue();
        },
        set: function (newVal) {
          ctrl.setValue(newVal);
          if (originalValueDesc && originalValueDesc.set) {
            originalValueDesc.set.call(this, ctrl.getValue());
          }
        },
        configurable: true
      });
    }

    wrapper.__rapiderPhoneCtrl = ctrl;
    targetElement.__rapiderPhoneCtrl = ctrl;

    return ctrl;
  }

  /**
   * Web Component: <rapider-phone-input>
   */
  if (typeof customElements !== 'undefined' && !customElements.get('rapider-phone-input')) {
    class RapiderPhoneInputElement extends HTMLElement {
      constructor() {
        super();
      }

      connectedCallback() {
        if (this._ctrl) return;
        const defaultCountry = this.getAttribute('default-country') || 'US';
        const initialValue = this.getAttribute('value') || '';
        const placeholder = this.getAttribute('placeholder') || null;
        const name = this.getAttribute('name') || null;
        const required = this.hasAttribute('required');
        const disabled = this.hasAttribute('disabled');

        this._ctrl = new PhoneInputController(this, {
          defaultCountry,
          initialValue,
          placeholder,
          name,
          required,
          disabled
        });
      }

      get value() {
        return this._ctrl ? this._ctrl.getValue() : (this.getAttribute('value') || '');
      }

      set value(v) {
        if (this._ctrl) {
          this._ctrl.setValue(v);
        } else {
          this.setAttribute('value', v);
        }
      }

      get country() {
        return this._ctrl ? this._ctrl.currentCountry.code : 'US';
      }

      set country(c) {
        if (this._ctrl && COUNTRY_MAP[c]) {
          this._ctrl.countrySelect.value = c;
          this._ctrl.countrySelect.dispatchEvent(new Event('change'));
        }
      }
    }

    customElements.define('rapider-phone-input', RapiderPhoneInputElement);
  }

  // Auto-initialize elements with data-rapider-phone on DOM ready
  if (typeof document !== 'undefined') {
    const autoInit = () => {
      document.querySelectorAll('input[data-rapider-phone], [data-rapider-phone]').forEach(el => {
        attach(el);
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit();
    }
  }

  return {
    COUNTRIES,
    COUNTRY_MAP,
    attach,
    PhoneInputController
  };
});
