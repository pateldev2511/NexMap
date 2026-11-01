/**
 * Save / load a design's rules as a file (see io/rulesFile). Shared by the Rules
 * tab and ⌘K. Saving is a plain download; loading opens the system file picker —
 * nothing leaves the machine either way.
 */
import { useProjectStore } from '@/store/projectStore';
import { downloadBlob } from '@/io/export/raster';
import { RULES_EXTENSION, rulesFileName, writeRulesFile } from '@/io/rulesFile';

/** Download this design's declared rules as `<project> rules.nexrules`. */
export function saveRulesFile(): void {
  const st = useProjectStore.getState();
  const n = st.invariantsEnabled.size + st.customRules.length;
  if (n === 0) {
    st.setFlash('Declare a rule first — there’s nothing to save yet.');
    return;
  }
  const name = rulesFileName(st.projectName);
  const text = writeRulesFile(
    { invariants: st.invariantsEnabled, customRules: st.customRules, enforced: st.rulesEnforced },
    st.projectName,
  );
  downloadBlob(new Blob([text], { type: 'application/json' }), name);
  st.setFlash(`Saved ${n} rule${n === 1 ? '' : 's'} to “${name}”. Load it into another design to hold it to the same rules.`);
}

/** Pick a rules file or a .nexmap design and merge its rules into this design. */
export function loadRulesFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = `${RULES_EXTENSION},.nexmap,.json,application/json`;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) useProjectStore.getState().importRules(await file.text(), file.name);
  };
  input.click();
}
