export type CmsLocale = 'en' | 'pt-BR';

export type CmsMessages = {
  new: string;
  edit: string;
  delete: string;
  restore: string;
  save: string;
  saving: string;
  publish: string;
  unpublish: string;
  history: string;
  preview: string;
  close: string;
  showDeleted: string;
  noDocuments: string;
  loading: string;
  json: string;
  form: string;
  current: string;
  noVersions: string;
  deleteConfirm: string;
};

export const cmsMessages: Record<CmsLocale, CmsMessages> = {
  en: {
    new: 'New',
    edit: 'Edit',
    delete: 'Delete',
    restore: 'Restore',
    save: 'Save',
    saving: 'Saving…',
    publish: 'Publish',
    unpublish: 'Unpublish',
    history: 'History',
    preview: 'Preview',
    close: 'Close',
    showDeleted: 'Show deleted',
    noDocuments: 'No documents yet.',
    loading: 'Loading…',
    json: 'JSON',
    form: 'Form',
    current: 'Current',
    noVersions: 'No versions yet.',
    deleteConfirm: 'Delete this document?',
  },
  'pt-BR': {
    new: 'Novo',
    edit: 'Editar',
    delete: 'Excluir',
    restore: 'Restaurar',
    save: 'Salvar',
    saving: 'Salvando…',
    publish: 'Publicar',
    unpublish: 'Despublicar',
    history: 'Histórico',
    preview: 'Visualizar',
    close: 'Fechar',
    showDeleted: 'Mostrar excluídos',
    noDocuments: 'Nenhum documento ainda.',
    loading: 'Carregando…',
    json: 'JSON',
    form: 'Formulário',
    current: 'Atual',
    noVersions: 'Nenhuma versão ainda.',
    deleteConfirm: 'Excluir este documento?',
  },
};
