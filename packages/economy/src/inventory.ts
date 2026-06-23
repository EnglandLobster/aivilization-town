export type Inventory = Readonly<Record<string, number>>;

export function getInventoryQuantity(inventory: Inventory, itemName: string): number {
  return inventory[itemName] ?? 0;
}

export function addInventory(inventory: Inventory, itemName: string, quantity: number): Inventory {
  assertNonNegativeFinite(quantity, 'quantity');
  return {
    ...inventory,
    [itemName]: getInventoryQuantity(inventory, itemName) + quantity,
  };
}

export function removeInventory(
  inventory: Inventory,
  itemName: string,
  quantity: number,
): Inventory {
  assertNonNegativeFinite(quantity, 'quantity');
  const current = getInventoryQuantity(inventory, itemName);
  if (current < quantity) {
    throw new Error(`insufficient ${itemName}: required ${quantity}, available ${current}`);
  }
  const nextQuantity = current - quantity;
  if (nextQuantity === 0) {
    const { [itemName]: _removed, ...rest } = inventory;
    return rest;
  }
  return {
    ...inventory,
    [itemName]: nextQuantity,
  };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
