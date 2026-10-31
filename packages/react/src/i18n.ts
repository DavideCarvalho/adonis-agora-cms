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
  schedule: string;
  schedulePublish: string;
  scheduleUnpublish: string;
  scheduled: string;
  unschedule: string;
  exportCsv: string;
  importCsv: string;
  imported: string;
  failedRows: string;
  mediaLibrary: string;
  link: string;
  image: string;
  apply: string;
  linkUrl: string;
  removeLink: string;
  compare: string;
  noDifferences: string;
  inThisVersion: string;
  inTheForm: string;
  autosaved: string;
  lockedBy: string;
  lockedHint: string;
  allStatuses: string;
  all: string;
  columns: string;
  jumpTo: string;
  nothingFound: string;
  uploading: string;
  replace: string;
  pickExisting: string;
  dropFile: string;
  orBrowse: string;
  backToDrop: string;
  uploadFailed: string;
  noUploadEndpoint: string;
  storedFile: string;
  filterOptions: string;
  selected: string;
  select: string;
  selectAll: string;
  duplicated: string;
  copySuffix: string;
  deleteManyTitle: string;
  saved: string;
  created: string;
  deleted: string;
  restored: string;
  published: string;
  unpublished: string;
  draft: string;
  unsavedChanges: string;
  discardTitle: string;
  discardBody: string;
  discard: string;
  cancel: string;
  back: string;
  deleteBody: string;
  search: string;
  noResults: string;
  clearSearch: string;
  noDocumentsHint: string;
  loadFailed: string;
  retry: string;
  requestFailed: string;
  status: string;
  updated: string;
  yes: string;
  no: string;
  previous: string;
  next: string;
  documents: string;
  document: string;
  content: string;
  globals: string;
  lightTheme: string;
  darkTheme: string;
  noCollections: string;
  signInTitle: string;
  signInBody: string;
  signIn: string;
  validationFailed: string;
  visual: string;
  blocks: string;
  onThisPage: string;
  addBlock: string;
  addBlockHint: string;
  emptyPage: string;
  documentFields: string;
  pickBlockType: string;
  pageDetailsBack: string;
  duplicate: string;
  remove: string;
  moveUp: string;
  moveDown: string;
  undo: string;
  openInTab: string;
  desktop: string;
  tablet: string;
  mobile: string;
  copy: string;
  addRow: string;
  pasteRow: string;
  pasteBlock: string;
  invalidJson: string;
  versionsFailed: string;
  autosave: string;
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
    schedule: 'Schedule',
    schedulePublish: 'Publish on',
    scheduleUnpublish: 'Unpublish on',
    scheduled: 'Scheduled',
    unschedule: 'Cancel schedule',
    exportCsv: 'Export CSV',
    importCsv: 'Import CSV',
    imported: 'imported',
    failedRows: 'failed',
    mediaLibrary: 'Media library',
    link: 'Link',
    image: 'Image',
    apply: 'Apply',
    linkUrl: 'Link address',
    removeLink: 'Remove link',
    compare: 'Compare',
    noDifferences: 'Same as what is in the form.',
    inThisVersion: 'This version',
    inTheForm: 'In the form',
    autosaved: 'Autosaved',
    lockedBy: 'Being edited by',
    lockedHint: 'You can read it, but editing is off until they leave.',
    allStatuses: 'All statuses',
    all: 'All',
    columns: 'Columns',
    jumpTo: 'Search documents and collections',
    nothingFound: 'Nothing found.',
    uploading: 'Uploading…',
    replace: 'Replace',
    pickExisting: 'Pick existing',
    dropFile: 'Drop a file here',
    orBrowse: 'or click to browse',
    backToDrop: 'Back to upload',
    uploadFailed: 'Upload failed. Try again.',
    noUploadEndpoint: 'Uploads are not configured: set `cms.uploads.handler`.',
    storedFile: 'stored file',
    filterOptions: 'Search options',
    selected: 'selected',
    select: 'Select',
    selectAll: 'Select all',
    duplicated: 'Duplicated: you are editing the copy',
    copySuffix: '(copy)',
    deleteManyTitle: 'Delete the selected documents?',
    saved: 'Saved',
    created: 'Created',
    deleted: 'Deleted',
    restored: 'Restored',
    published: 'Published',
    unpublished: 'Unpublished',
    draft: 'Draft',
    unsavedChanges: 'Unsaved changes',
    discardTitle: 'Discard your changes?',
    discardBody: 'What you changed since the last save will be lost.',
    discard: 'Discard',
    cancel: 'Cancel',
    back: 'Back',
    deleteBody: 'This cannot be undone from here.',
    search: 'Search',
    noResults: 'Nothing matches this search.',
    clearSearch: 'Clear search',
    noDocumentsHint: 'Create the first one to see it here.',
    loadFailed: 'Could not load this list.',
    retry: 'Try again',
    requestFailed: 'The request failed. Try again.',
    status: 'Status',
    updated: 'Updated',
    yes: 'Yes',
    no: 'No',
    previous: 'Previous',
    next: 'Next',
    documents: 'documents',
    document: 'document',
    content: 'Content',
    globals: 'Globals',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    noCollections: 'No collections configured.',
    signInTitle: 'Sign in required',
    signInBody: 'Your session expired or you are not authenticated.',
    signIn: 'Go to sign in',
    validationFailed: 'Fix these fields to save:',
    visual: 'Visual',
    blocks: 'Blocks',
    onThisPage: 'On this page',
    addBlock: 'Add a block',
    addBlockHint: 'Click to append, or drag into the page.',
    emptyPage: 'No blocks yet. Add the first one below.',
    documentFields: 'Page details',
    pickBlockType: 'Pick a block type to edit its fields.',
    pageDetailsBack: 'Page details',
    duplicate: 'Duplicate',
    remove: 'Remove',
    moveUp: 'Move up',
    moveDown: 'Move down',
    undo: 'Undo',
    openInTab: 'Open in a new tab',
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile',
    copy: 'Copy',
    addRow: 'Add row',
    pasteRow: 'Paste row',
    pasteBlock: 'Paste block',
    invalidJson: 'Invalid JSON: fix it to apply the change.',
    versionsFailed: 'Could not load the versions.',
    autosave: 'autosave',
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
    preview: 'Pré-visualizar',
    close: 'Fechar',
    showDeleted: 'Mostrar excluídos',
    noDocuments: 'Nenhum documento ainda.',
    loading: 'Carregando…',
    json: 'JSON',
    form: 'Formulário',
    current: 'Atual',
    noVersions: 'Nenhuma versão ainda.',
    deleteConfirm: 'Excluir este documento?',
    schedule: 'Agendar',
    schedulePublish: 'Publicar em',
    scheduleUnpublish: 'Despublicar em',
    scheduled: 'Agendado',
    unschedule: 'Cancelar agendamento',
    exportCsv: 'Exportar CSV',
    importCsv: 'Importar CSV',
    imported: 'importados',
    failedRows: 'com erro',
    mediaLibrary: 'Biblioteca de mídia',
    link: 'Link',
    image: 'Imagem',
    apply: 'Aplicar',
    linkUrl: 'Endereço do link',
    removeLink: 'Remover link',
    compare: 'Comparar',
    noDifferences: 'Igual ao que está no formulário.',
    inThisVersion: 'Esta versão',
    inTheForm: 'No formulário',
    autosaved: 'Salvo automaticamente',
    lockedBy: 'Em edição por',
    lockedHint: 'Você pode ler, mas a edição fica bloqueada até a pessoa sair.',
    allStatuses: 'Todos os status',
    all: 'Todos',
    columns: 'Colunas',
    jumpTo: 'Buscar documentos e coleções',
    nothingFound: 'Nada encontrado.',
    uploading: 'Enviando…',
    replace: 'Substituir',
    pickExisting: 'Escolher existente',
    dropFile: 'Solte um arquivo aqui',
    orBrowse: 'ou clique para escolher',
    backToDrop: 'Voltar para o envio',
    uploadFailed: 'O envio falhou. Tente de novo.',
    noUploadEndpoint: 'Upload não configurado: defina `cms.uploads.handler`.',
    storedFile: 'arquivo salvo',
    filterOptions: 'Buscar opções',
    selected: 'selecionados',
    select: 'Selecionar',
    selectAll: 'Selecionar todos',
    duplicated: 'Duplicado: você está editando a cópia',
    copySuffix: '(cópia)',
    deleteManyTitle: 'Excluir os documentos selecionados?',
    saved: 'Salvo',
    created: 'Criado',
    deleted: 'Excluído',
    restored: 'Restaurado',
    published: 'Publicado',
    unpublished: 'Despublicado',
    draft: 'Rascunho',
    unsavedChanges: 'Alterações não salvas',
    discardTitle: 'Descartar alterações?',
    discardBody: 'O que você mudou desde o último salvamento será perdido.',
    discard: 'Descartar',
    cancel: 'Cancelar',
    back: 'Voltar',
    deleteBody: 'Isso não pode ser desfeito por aqui.',
    search: 'Buscar',
    noResults: 'Nada encontrado nessa busca.',
    clearSearch: 'Limpar busca',
    noDocumentsHint: 'Crie o primeiro para vê-lo aqui.',
    loadFailed: 'Não foi possível carregar a lista.',
    retry: 'Tentar de novo',
    requestFailed: 'A requisição falhou. Tente de novo.',
    status: 'Status',
    updated: 'Atualizado',
    yes: 'Sim',
    no: 'Não',
    previous: 'Anterior',
    next: 'Próxima',
    documents: 'documentos',
    document: 'documento',
    content: 'Conteúdo',
    globals: 'Globais',
    lightTheme: 'Tema claro',
    darkTheme: 'Tema escuro',
    noCollections: 'Nenhuma coleção configurada.',
    signInTitle: 'É preciso entrar',
    signInBody: 'Sua sessão expirou ou você não está autenticado.',
    signIn: 'Ir para o login',
    validationFailed: 'Corrija estes campos para salvar:',
    visual: 'Visual',
    blocks: 'Blocos',
    onThisPage: 'Nesta página',
    addBlock: 'Adicionar bloco',
    addBlockHint: 'Clique para adicionar ao fim ou arraste para a página.',
    emptyPage: 'Nenhum bloco ainda. Adicione o primeiro abaixo.',
    documentFields: 'Dados da página',
    pickBlockType: 'Escolha um tipo de bloco para editar os campos.',
    pageDetailsBack: 'Dados da página',
    duplicate: 'Duplicar',
    remove: 'Remover',
    moveUp: 'Mover para cima',
    moveDown: 'Mover para baixo',
    undo: 'Desfazer',
    openInTab: 'Abrir em nova aba',
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Celular',
    copy: 'Copiar',
    addRow: 'Adicionar linha',
    pasteRow: 'Colar linha',
    pasteBlock: 'Colar bloco',
    invalidJson: 'JSON inválido: corrija para aplicar a alteração.',
    versionsFailed: 'Não foi possível carregar as versões.',
    autosave: 'salvamento automático',
  },
};
