The files in this directory are used to test three scenarios when producing messages to a Kafka
topic:

- `good.json`: basic `key` and `value` fields, the latter follows the `customer` example in the
  `tests/fixtures/schemas` directory
- `bad_missing-key.json`: missing `key` field, should raise an basic JSON validation error
- `ugly_schema-validation-error.json`: `value` field is not a valid `customer` object, should raise
  a schema validationerror
