import * as assert from "assert";
import "mocha";
import { ObjectSet } from "./objectset";

describe("ObjectSet", () => {
  it("should add unique items based on key function", () => {
    // Create a set that uses 'id' as the key
    const set = new ObjectSet<{ id: string; value: string }>((item) => item.id);

    // Add items with unique keys
    assert.strictEqual(set.add({ id: "1", value: "first" }), true);
    assert.strictEqual(set.add({ id: "2", value: "second" }), true);

    // Adding an item with a duplicate key should return false
    assert.strictEqual(set.add({ id: "1", value: "another first" }), false);

    // Should only have 2 items
    assert.strictEqual(set.size, 2);

    // Verify the items are as expected
    const items = set.items();
    assert.deepStrictEqual(items.map((i) => i.value).sort(), ["first", "second"]);
  });

  it("should detect if an item is contained in the set", () => {
    const set = new ObjectSet<{ id: string }>((item) => item.id);

    // Add an item
    set.add({ id: "test" });

    // Should find an item with the same key
    assert.strictEqual(set.contains({ id: "test" }), true);

    // Should not find an item with a different key
    assert.strictEqual(set.contains({ id: "other" }), false);
  });

  it("should work with complex keys", () => {
    // Create a set with a complex key function
    const set = new ObjectSet<{ first: string; last: string }>(
      (item) => `${item.first}:${item.last}`,
    );

    set.add({ first: "John", last: "Doe" });
    set.add({ first: "Jane", last: "Doe" });

    // Same composite key should be detected as a duplicate
    assert.strictEqual(set.add({ first: "John", last: "Doe" }), false);

    assert.strictEqual(set.size, 2);
  });

  // Test remove
  it("should remove items from the set", () => {
    const set = new ObjectSet<{ id: string }>((item) => item.id);

    // Add items
    set.add({ id: "1" });
    set.add({ id: "2" });

    // Remove an item
    assert.strictEqual(set.remove({ id: "1" }), true);

    // Check size after removal
    assert.strictEqual(set.size, 1);

    // Check if the removed item is still in the set
    assert.strictEqual(set.contains({ id: "1" }), false);

    // Removing an item that doesn't exist should return false
    assert.strictEqual(set.remove({ id: "3" }), false);
  });

  // Test over clear
  it("should clear the set", () => {
    const set = new ObjectSet<{ id: string }>((item) => item.id);

    // Add items
    set.add({ id: "1" });
    set.add({ id: "2" });

    // Clear the set
    set.clear();

    // Check size after clearing
    assert.strictEqual(set.size, 0);
  });
});
