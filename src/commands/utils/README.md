This subdirectory is for utility functions used by the command-functions themselves. Separating them
from the command modules will help readability/maintainability while also better supporting test
suite setup.

Any functions that are not specific to commands should be moved into a higher-level module.
