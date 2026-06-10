// utils/htmlEscape.js
// Escapes HTML special characters to prevent XSS in email templates.
// Used by emailService when interpolating user-supplied data into templates.

const htmlEscape = (str) => {
  if (str === null || str === undefined) {
    return '';
  }
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

module.exports = htmlEscape;
