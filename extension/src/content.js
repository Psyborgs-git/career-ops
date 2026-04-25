/**
 * Content Script — Career-Ops Extension
 *
 * Injected into job application pages.
 * Waits for commands from the sidebar (doesn't auto-detect on load).
 */

console.log('[Career-Ops] Content script loaded');

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return !(
    el.disabled ||
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    rect.width === 0 ||
    rect.height === 0
  );
}

function getFormElements() {
  return Array.from(document.querySelectorAll('input, textarea, select'))
    .filter((el) => {
      const type = (el.type || '').toLowerCase();
      return !['hidden', 'submit', 'button', 'image', 'reset'].includes(type) && isVisible(el);
    });
}

function assignFieldId(el, index) {
  const existingId = el.dataset.careerOpsFieldId;
  if (existingId) return existingId;

  const fieldId = `field-${index}`;
  el.dataset.careerOpsFieldId = fieldId;
  return fieldId;
}

/**
 * Detect all form fields on the current page.
 */
function detectFormFields() {
  const fields = [];
  const elements = getFormElements();

  elements.forEach((el, index) => {
    const fieldId = assignFieldId(el, index);

    fields.push({
      id: fieldId,
      tagName: el.tagName.toLowerCase(),
      inputType: el.type || '',
      name: el.name || el.id || `field-${index}`,
      label: findLabel(el),
      placeholder: el.placeholder || '',
      required: el.required || false,
      value: el.value || '',
      accept: el.accept || '',
      multiple: !!el.multiple,
      options: el.tagName === 'SELECT'
        ? Array.from(el.options).map(o => ({ text: o.text, value: o.value }))
        : [],
    });
  });

  return fields;
}

/**
 * Find the label for a form element.
 */
function findLabel(el) {
  // Explicit <label for="...">
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent.trim();
  }

  // Parent label
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();

  // aria-label
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }

  // Previous sibling text (common in Ashby forms)
  const prev = el.previousElementSibling;
  if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
    const text = prev.textContent.trim();
    if (text.length < 100) return text;
  }

  // Placeholder as fallback
  return el.placeholder || '';
}

/**
 * Autofill form fields with provided answers.
 */
function autofillForm(answers) {
  const elements = getFormElements();
  let filledCount = 0;

  elements.forEach((el, index) => {
    const fieldId = assignFieldId(el, index);
    const answer = answers[fieldId];
    if (!answer || answer.value === undefined || answer.value === null || answer.value === '') return;

    try {
      if (el.tagName === 'SELECT') {
        const targetValue = String(answer.value).toLowerCase();
        const exactOption = Array.from(el.options).find(option => option.value === answer.value);
        const fuzzyOption = Array.from(el.options).find(option => {
          const optionText = `${option.text} ${option.value}`.toLowerCase();
          return optionText.includes(targetValue);
        });

        const selectedOption = exactOption || fuzzyOption;
        if (selectedOption) {
          el.value = selectedOption.value;
        }
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        const truthy = answer.value === 'true' || answer.value === true || answer.value === 'yes';
        if (el.type === 'radio') {
          const radioValue = String(el.value || '').toLowerCase();
          const desiredValue = String(answer.value).toLowerCase();
          el.checked = radioValue === desiredValue || (truthy && ['yes', 'true'].includes(radioValue));
        } else {
          el.checked = truthy;
        }
      } else {
        // Use native input setter to work with React forms
        const prototype = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, answer.value);
        } else {
          el.value = answer.value;
        }
      }

      // Dispatch events for React/framework compatibility
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      // Visual feedback
      el.style.outline = '2px solid hsl(187, 74%, 32%)';
      setTimeout(() => { el.style.outline = ''; }, 3000);

      filledCount++;
    } catch (err) {
      console.warn(`[Career-Ops] Failed to fill ${fieldId}:`, err);
    }
  });

  return filledCount;
}

/**
 * Convert base64 to Blob
 */
function b64toBlob(b64Data, contentType = '', sliceSize = 512) {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];
  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: contentType });
}

/**
 * Programmatically attach a file to a file input element.
 */
function attachFileToForm(base64Data, filename, contentType = 'application/pdf') {
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  if (fileInputs.length === 0) {
    return { success: false, error: 'No file input found on this page.' };
  }

  // Find the best input (try to find one for resume/cv, fallback to first)
  const rankedInputs = [
    ...fileInputs.filter(isVisible),
    ...fileInputs.filter(input => !isVisible(input)),
  ];

  let targetInput = rankedInputs.find(input => {
    const n = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const aria = (input.getAttribute('aria-label') || '').toLowerCase();
    return n.includes('resume') || n.includes('cv') || 
           id.includes('resume') || id.includes('cv') ||
           aria.includes('resume') || aria.includes('cv');
  }) || rankedInputs[0];

  try {
    const blob = b64toBlob(base64Data, contentType);
    const file = new File([blob], filename, { type: contentType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    targetInput.files = dataTransfer.files;
    
    // Trigger events for React/Frameworks to pick it up
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Visual feedback
    targetInput.style.outline = '2px solid hsl(270, 70%, 45%)';
    setTimeout(() => { targetInput.style.outline = ''; }, 3000);

    return { success: true, inputId: targetInput.id || targetInput.name };
  } catch (err) {
    console.error('[Career-Ops] Attach error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Listen for commands from the background/sidebar.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'DETECT_FORM': {
      const fields = detectFormFields();
      sendResponse({ success: true, fields, count: fields.length });
      break;
    }

    case 'AUTOFILL_FORM': {
      const count = autofillForm(msg.payload?.answers || {});
      sendResponse({ success: true, filledCount: count });
      break;
    }

    case 'ATTACH_FILE': {
      const { base64Data, filename, contentType } = msg.payload || {};
      if (!base64Data || !filename) {
        sendResponse({ success: false, error: 'Missing file data or filename' });
        break;
      }
      const result = attachFileToForm(base64Data, filename, contentType);
      sendResponse(result);
      break;
    }

    default:
      sendResponse({ success: false, error: `Unknown command: ${msg.type}` });
  }
  return true;
});
