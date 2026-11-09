// Reviewed browser-removal retirements, pinned to the exact deleted fixtures.
// The old balance/scrape, DOM auth/dashboard, Init and form owners are gone.
// The Common lookalike guard is superseded by the unconditional Common ban.
export const BROWSER_CANARY_RETIREMENTS = Object.freeze({
  'account-scrape-file-over-cap.canary.ts':
    '574b3acb931aee5bd23ddd7b81bedafce83b9b2432ded22661b16abb38244f72',
  'balance-fetch-only-in-balance-resolve.canary.ts':
    'cac6119eb090ca31bda41e06e890eeed0e25b518b96d0e8309a1d96a03d3a23b',
  'balance-resolve-bulk-literal.canary.ts':
    'b9d97eee31205e83e6d0556faa182c0b498379553d41a4f5161d052373fafcaa',
  'balance-resolve-isolation.canary.ts':
    '73d29c5e930b23202912d28a9001f303348faf0044d75845227802d3e3cd99a3',
  'balance-resolve-throw-leaks-quarantine.canary.ts':
    '739d408545bd1d5642a6092326ef8a91290c4b8c6786082e8ae0aaa32dc53248',
  'form-sub-fn-over-cap.canary.ts':
    'df4594dd456ac8e4e34ea9f0b0e51fa24f5af29fbd8d0aceba48b4a58c4d72ff',
  'init-cluster-fn-over-cap.canary.ts':
    '7cb78af37217caefc74929ebfa196e36db566a2d7ad6eeddbd5c33a77e8267ff',
  'init-transport-probe-file-over-cap.canary.ts':
    '104e0b90f9465139b80eb3a9936ddef9bff3121ef7773e0a4a163971dab72509',
  'mediator-auth-file-over-cap.canary.ts':
    '3b749b9dec9549953acaae02429e608c6c92f8467445016c677c3a804484b4e4',
  'mediator-auth-fn-over-cap.canary.ts':
    '1a608851b6b9c87a7e3250aa875d924bf702a650c5ec04d63bbee7b453a6ce81',
  'mediator-dashboard-file-over-cap.canary.ts':
    '325f03bdbd8f3fdbc0884287a6def4ba63fe48344181aa8e0674b2179c8a1bbe',
  'mediator-dashboard-fn-over-cap.canary.ts':
    'e522663675990d9392f5a6f6b50691b811c3fc3a1e59ecfb0b5165beb7b11632',
  'no-balance-in-scrape.canary.ts':
    'c1a62c48d4e4d913001fd63c05f70d3e6ba8067cd495246b2afa1e0e5eb80350',
  'no-common-config-lookalike-in-pipeline.canary.ts':
    '01ffd678a01d25060baa66277724965292198173f506efa3fa923ca642dcecab',
  'scrape-data-file-over-cap.canary.ts':
    'e04e4f11c3042d7f1205e084e72ff69fef2868a0ff341ef440ae6aa0cb93a679',
  'scrape-data-fn-over-cap.canary.ts':
    '7e8401ac7999e1907a1bf6c96844bba2a566f026c49e97adce8f5639e620a5ae',
  'scrape-executor-file-over-cap.canary.ts':
    'ae84c323699278bb4a51ad0cbb8ce185dc3bbf64bb7ab37f9e7219cd0516d230',
  'scrape-executor-fn-over-cap.canary.ts':
    'f7e8cf18bb7cffd781644e5364172dd5328a6b3e8e56dd86fa114880adfb5927',
});

function validEntry([name, hash]) {
  return (
    /^[\w.-]+\.canary\.ts$/.test(name) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
  );
}

function inventoryOf(guardrails) {
  const files = guardrails.canaryFiles;
  if (!files || typeof files !== 'object' || Array.isArray(files))
    throw new Error('Invalid canary inventory');
  const entries = Object.entries(files);
  if (entries.length !== guardrails.canaries || !entries.every(validEntry))
    throw new Error('Canary inventory does not match the measured count or hash format');
  return files;
}

function approved([name, hash]) {
  return (
    Object.hasOwn(BROWSER_CANARY_RETIREMENTS, name) && BROWSER_CANARY_RETIREMENTS[name] === hash
  );
}

function classify(entries) {
  return {
    approved: entries.filter(approved).map(([name]) => name),
    unapproved: entries.filter(entry => !approved(entry)).map(([name]) => name),
  };
}

export function canaryRetirements(base, head) {
  // Old snapshots get the original strict count ratchet, never retirement credit.
  if (base.canaryFiles === undefined || head.canaryFiles === undefined)
    return { approved: [], unapproved: [] };
  const before = inventoryOf(base);
  const after = inventoryOf(head);
  const removed = Object.entries(before).filter(([name]) => !Object.hasOwn(after, name));
  return classify(removed);
}
