The files in this directory are used to test three scenarios when producing messages to a Kafka
topic:

- `produce-good.json`: basic `key` and `value` fields, the latter follows the `customer` example in
  the `tests/fixtures/schemas` directory
- `produce-bad.json`: missing `key` field, should raise an basic JSON validation error
- `produce-ugly.json`: `value` field is not a valid `customer` object, should raise a schema
  validationerror
