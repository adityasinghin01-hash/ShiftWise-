// tests/schema-bounds.test.js
// TDD RED: Verifies all Mongoose models have maxlength on string fields
// to prevent unbounded data DoS attacks.

const fs = require('fs');
const path = require('path');

describe('Schema Bounds — maxlength on String Fields', () => {
  const SCHEMAS_TO_CHECK = [
    {
      name: 'User',
      path: path.join(__dirname, '..', 'models', 'User.js'),
      fields: ['name', 'picture'],
    },
  ];

  test.each(SCHEMAS_TO_CHECK)(
    '$name model must have maxlength on fields: $fields',
    ({ path: filePath, fields }) => {
      const source = fs.readFileSync(filePath, 'utf-8');
      for (const field of fields) {
        // The field definition block should contain maxlength
        // Look for the field name followed by a block containing maxlength
        const fieldRegex = new RegExp(`${field}\\s*:\\s*\\{[^}]*maxlength`, 's');
        expect(source).toMatch(fieldRegex);
      }
    }
  );
});
