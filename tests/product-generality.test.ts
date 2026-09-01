import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateProductOperationalFacts, type ProductOperationalFactsInput } from '@/lib/exporter-facts/service';
import { COMMERCIAL_QUANTITY_UNITS, canonicalProductUnit } from '@/lib/product-profile';

const profiles: Array<{ name: string; facts: ProductOperationalFactsInput }> = [
  { name: 'Basmati rice', facts: { commercial_quantity_unit: 'kg', capacity_value: '40', capacity_unit: 'tonne', moq_value: '1000', moq_unit: 'kg', packaging_format: 'bag', pack_size_value: '25', pack_size_unit: 'kg', transport_mode_compatibility: ['ocean', 'road'] } },
  { name: 'sugar', facts: { commercial_quantity_unit: 'tonne', capacity_value: '200', capacity_unit: 'tonne', packaging_format: 'bulk', container_compatibility: ['20FT_DRY'] } },
  { name: 'jute', facts: { commercial_quantity_unit: 'kg', packaging_format: 'bale', pack_size_value: '50', pack_size_unit: 'kg' } },
  { name: 'cricket bat', facts: { commercial_quantity_unit: 'piece', piece_unit_name: 'bat', packaging_format: 'carton', units_per_carton: 10, transport_mode_compatibility: ['air'] } },
  { name: 'cricket ball', facts: { commercial_quantity_unit: 'piece', piece_unit_name: 'ball', packaging_format: 'carton', units_per_carton: 48 } },
  { name: 'brassware', facts: { commercial_quantity_unit: 'piece', unit_net_weight_value: '2', unit_net_weight_unit: 'kg' } },
  { name: 'glassware', facts: { commercial_quantity_unit: 'piece', packaging_format: 'carton', fragile: true, special_handling_codes: ['FRAGILE'] } },
  { name: 'carpet', facts: { commercial_quantity_unit: 'm2', piece_unit_name: 'carpet', unit_length_value: '2', unit_width_value: '3', unit_dimension_unit: 'metre' } },
  { name: 'furniture', facts: { commercial_quantity_unit: 'piece', unit_volume_value: '1.2', unit_volume_unit: 'm3', transport_mode_compatibility: ['road', 'multimodal'] } },
  { name: 'pump machinery', facts: { commercial_quantity_unit: 'piece', unit_gross_weight_value: '85', unit_gross_weight_unit: 'kg' } },
  { name: 'electrical cable', facts: { commercial_quantity_unit: 'metre', capacity_value: '10000', capacity_unit: 'metre', unit_net_weight_value: '0.4', unit_net_weight_unit: 'kg' } },
  { name: 'industrial chemical', facts: { commercial_quantity_unit: 'litre', packaging_format: 'drum', pack_size_value: '200', pack_size_unit: 'litre', hazardous: true, dangerous_goods_un_number: 'UN 1993', transport_mode_compatibility: ['road', 'ocean'] } },
];

describe('universal physical-goods profile', () => {
  test('the universal Product model has no product-specific master fields', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const productModel = schema.match(/model Product \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(productModel).not.toMatch(/is_basmati|cricket_bat_wood_type|sugar_grade|jute_quality/i);
    expect(schema).toContain('model ProductClassificationRefinement');
  });

  test.each(profiles)('$name has no rice, kg-only or sea-only requirement', ({ facts }) => {
    expect(validateProductOperationalFacts(facts)).toEqual([]);
    expect(COMMERCIAL_QUANTITY_UNITS).toContain(canonicalProductUnit(facts.commercial_quantity_unit));
  });

  test('does not perform or permit implicit incompatible-unit conversion', () => {
    expect(validateProductOperationalFacts({ unit_net_weight_value: '1', unit_net_weight_unit: 'kg', unit_gross_weight_value: '2', unit_gross_weight_unit: 'tonne' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'incompatible_unit' })]));
    // Capacity and MOQ may be declared in different units, but downstream comparison must keep
    // them incomparable; validation stores the declarations and never converts either value.
    expect(validateProductOperationalFacts({ capacity_value: '2', capacity_unit: 'tonne', moq_value: '500', moq_unit: 'kg' })).toEqual([]);
  });

  test('rejects changing a unit without its dependent quantity', () => {
    expect(validateProductOperationalFacts({ capacity_unit: 'kg' })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'incomplete' })]));
  });

  test('handling is optional for irrelevant goods and unknown stays unknown', () => {
    expect(validateProductOperationalFacts({ commercial_quantity_unit: 'piece' })).toEqual([]);
    expect(validateProductOperationalFacts({})).toEqual([]);
  });

  test('hazardous declarations cannot shed their classification through a partial patch', () => {
    expect(validateProductOperationalFacts({ hazardous: false }, { hazardous: true, dangerous_goods_un_number: 'UN 1993' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: 'hazardous', code: 'conflict' })]));
    expect(validateProductOperationalFacts({ hazardous: true }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'handling_required' })]));
  });
});
