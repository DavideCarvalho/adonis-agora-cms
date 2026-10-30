import { describe, expect, test } from 'vitest';
import { cmsMessages } from '../src/i18n.js';

describe('admin messages', () => {
  test('every locale exposes the same keys', () => {
    expect(Object.keys(cmsMessages.en).sort()).toEqual(Object.keys(cmsMessages['pt-BR']).sort());
  });

  test('pt-BR is actually translated for the core actions', () => {
    expect(cmsMessages['pt-BR']).toMatchObject({
      save: 'Salvar',
      delete: 'Excluir',
      restore: 'Restaurar',
      history: 'Histórico',
      showDeleted: 'Mostrar excluídos',
    });
  });
});
