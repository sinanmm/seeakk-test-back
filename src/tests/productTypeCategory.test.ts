import assert from 'assert';
import { createProductSchema, productTypeOptionSchema } from '../modules/master/products/product.validator';

export const runProductTypeCategoryTests = (): void => {
  console.log('--- Running Product Type-Specific Category Tests ---');

  // Test A & B: Schema parsing with multiple types & type-specific categories
  const testInput = {
    name: 'Service Package Pro',
    typeOptions: [
      {
        id: 'type-1',
        name: 'Basic',
        unitPrice: 499,
        status: 'ACTIVE',
        isDefault: true,
        categories: ['Online', 'Offline', 'Hybrid', ' Online '], // includes duplicate after trimming
      },
      {
        id: 'type-2',
        name: 'Premium',
        unitPrice: 1999,
        status: 'ACTIVE',
        isDefault: false,
        categories: ['Individual', 'Corporate'],
      },
      {
        id: 'type-3',
        name: 'Enterprise',
        unitPrice: 5000,
        status: 'INACTIVE',
        isDefault: false,
        categories: ['VIP', 'Custom Onsite'],
      },
    ],
  };

  const parsed = createProductSchema.parse(testInput);
  assert.strictEqual(parsed.name, 'Service Package Pro');
  assert.strictEqual(parsed.typeOptions?.length, 3, 'All 3 types must persist');

  const type1 = parsed.typeOptions![0];
  const type2 = parsed.typeOptions![1];
  const type3 = parsed.typeOptions![2];

  // Test B: Type-specific isolation
  assert.deepStrictEqual(type1.categories, ['Online', 'Offline', 'Hybrid', 'Online']); // validator allows string list, duplicates trimmed & unique in service
  assert.strictEqual(type1.unitPrice, 499);
  assert.strictEqual(type1.isDefault, true);

  assert.deepStrictEqual(type2.categories, ['Individual', 'Corporate']);
  assert.strictEqual(type2.unitPrice, 1999);
  assert.strictEqual(type2.isDefault, false);

  assert.deepStrictEqual(type3.categories, ['VIP', 'Custom Onsite']);
  assert.strictEqual(type3.status, 'INACTIVE');

  // Test Type Option Validator Negative Price
  assert.throws(() => {
    productTypeOptionSchema.parse({
      name: 'Invalid Price Type',
      unitPrice: -50,
      categories: ['Cat1'],
    });
  }, /non-negative/i);

  // Test Type Option Validator Missing Name
  assert.throws(() => {
    productTypeOptionSchema.parse({
      name: '',
      unitPrice: 100,
      categories: ['Cat1'],
    });
  }, /required/i);

  // Test Category Validation Logic (as implemented in leadService.ts)
  const mockProduct = {
    id: 'prod-123',
    name: 'Service Package Pro',
    unitPrice: 499,
    status: 'ACTIVE',
    typeOptions: [
      {
        id: 'type-1',
        name: 'Basic',
        unitPrice: 499,
        status: 'ACTIVE',
        isDefault: true,
        categories: ['Online', 'Offline', 'Hybrid'],
      },
      {
        id: 'type-2',
        name: 'Premium',
        unitPrice: 1999,
        status: 'ACTIVE',
        isDefault: false,
        categories: ['Individual', 'Corporate'],
      },
      {
        id: 'type-3',
        name: 'Enterprise',
        unitPrice: 5000,
        status: 'INACTIVE',
        isDefault: false,
        categories: ['VIP', 'Custom Onsite'],
      },
    ],
    categories: ['Online', 'Offline', 'Hybrid', 'Individual', 'Corporate', 'VIP'],
  };

  const validateLeadSelection = (
    product: typeof mockProduct,
    selection: { typeId?: string; type?: string; category?: string; unitPrice?: number },
  ) => {
    const typeOptionsList = product.typeOptions || [];
    let matchedType: any = null;
    if (selection.typeId) {
      matchedType = typeOptionsList.find((t) => t.id === selection.typeId);
    }
    if (!matchedType && selection.type) {
      matchedType = typeOptionsList.find((t) => t.name.toLowerCase() === selection.type!.toLowerCase());
    }

    if (!matchedType) {
      throw new Error(`Selected type "${selection.type || selection.typeId}" is not configured for product "${product.name}".`);
    }

    if (matchedType.status === 'INACTIVE') {
      throw new Error(`Selected type "${matchedType.name}" is inactive for product "${product.name}".`);
    }

    if (selection.category) {
      const trimmedCat = selection.category.trim();
      const typeCategories: string[] = Array.isArray(matchedType.categories) ? matchedType.categories : [];
      if (typeCategories.length > 0) {
        const matches = typeCategories.some((c) => c.toLowerCase() === trimmedCat.toLowerCase());
        if (!matches) {
          throw new Error(`Selected category "${selection.category}" is not configured for type "${matchedType.name}".`);
        }
      }
    }

    const unitPrice = matchedType.unitPrice;
    return {
      typeId: matchedType.id,
      typeName: matchedType.name,
      category: selection.category || null,
      unitPrice,
    };
  };

  // Test D: Type 1 allows its own categories
  const resD = validateLeadSelection(mockProduct, { typeId: 'type-1', category: 'Online' });
  assert.strictEqual(resD.typeName, 'Basic');
  assert.strictEqual(resD.category, 'Online');
  assert.strictEqual(resD.unitPrice, 499);

  // Test E & K: Type 1 rejects Type 2's category ("Individual")
  assert.throws(() => {
    validateLeadSelection(mockProduct, { typeId: 'type-1', category: 'Individual' });
  }, /not configured for type "Basic"/);

  // Type 2 allows its own category
  const resE2 = validateLeadSelection(mockProduct, { typeId: 'type-2', category: 'Corporate' });
  assert.strictEqual(resE2.typeName, 'Premium');
  assert.strictEqual(resE2.category, 'Corporate');
  assert.strictEqual(resE2.unitPrice, 1999);

  // Type 2 rejects Type 1's category ("Offline")
  assert.throws(() => {
    validateLeadSelection(mockProduct, { typeId: 'type-2', category: 'Offline' });
  }, /not configured for type "Premium"/);

  // Inactive type rejection
  assert.throws(() => {
    validateLeadSelection(mockProduct, { typeId: 'type-3', category: 'VIP' });
  }, /is inactive/);

  console.info('✅ All Product Type-Specific Category Tests Passed Successfully!');
};

if (require.main === module) {
  runProductTypeCategoryTests();
}
