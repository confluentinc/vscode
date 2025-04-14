/**
 * Generic Set implementation over user defined types based
 * on that type and a constructor-provided key-extraction function.
 */
export class ObjectSet<T> {
  private members = new Map<string, T>();

  constructor(private keyFn: (item: T) => string) {}

  /** How many members?*/
  get size(): number {
    return this.members.size;
  }

  /** Clear the set */
  clear(): void {
    this.members.clear();
  }

  /**
   * Adds an item to the set if its corresponding key
   * is not already present.
   *
   * @returns true if the item was added, false otherwise.
   */
  add(item: T): boolean {
    const key = this.keyFn(item);
    if (!this.members.has(key)) {
      this.members.set(key, item);
      return true;
    }
    return false;
  }

  /**
   * Removes an item from the set based on its key.
   *
   * @returns true if the item was removed, false otherwise.
   */
  remove(item: T): boolean {
    const key = this.keyFn(item);
    return this.members.delete(key);
  }

  /** Is this item alread in the set? */
  contains(item: T): boolean {
    const key = this.keyFn(item);
    return this.members.has(key);
  }

  /** Return the unique'd items as an array */
  items(): T[] {
    return Array.from(this.members.values());
  }
}
