# Description of schema files used for testing

- `customer.avsc` Used to test the happy path of creating a new subject.
- `customer_bad_evolution.avsc` Used to test error handling when evolving a schema to a version that
  is not compatible with the previous version.
- `customer_good_evolution.avsc` Used to test the happy path of evolving a schema to a new version.
