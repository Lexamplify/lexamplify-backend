const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'components', 'AutoDraftWorkspace.jsx');
let content = fs.readFileSync(file, 'utf8');

let actualSplit = content.indexOf('  return (\n    <div className="autodraft-page-wrapper">');
if (actualSplit === -1) actualSplit = content.indexOf('  return (\n    <div');
if (actualSplit === -1) actualSplit = content.indexOf('  return (');
if (actualSplit === -1) throw new Error('Could not find split index');

let top = content.substring(0, actualSplit);

const stateVars = `
  const [activeMods, setActiveMods] = useState({ cure: false, feecap: false, seat: false, carveout: false });
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [toolbarRef, setToolbarRef] = useState(null);

  const toggleMod = (modKey, text) => {
    setActiveMods(prev => {
      const next = !prev[modKey];
      let currentPrompt = autoDraftPrompt || '';
      if (next) {
        if (!currentPrompt.includes(text)) {
           setAutoDraftPrompt(currentPrompt.trim() ? \`\${currentPrompt.trim()}\\n- \${text}\` : \`- \${text}\`);
        }
      } else {
        const regex = new RegExp(\`\\\\n?- \${text.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&')}\`, 'g');
        setAutoDraftPrompt(currentPrompt.replace(regex, '').trim());
      }
      return { ...prev, [modKey]: next };
    });
  };

  const getStatutes = () => {
    const set = new Set();
    if (autoDraftText) {
      set.add('Indian Contract Act, 1872');
      if (autoDraftText.toLowerCase().includes('arbitration') || activeMods.carveout) set.add('Arbitration and Conciliation Act, 1996');
      if (autoDraftText.toLowerCase().includes('company')) set.add('Companies Act, 2013');
      if (autoDraftText.toLowerCase().includes('copyright')) set.add('Copyright Act, 1957');
    }
    return Array.from(set);
  };
  const statutes = getStatutes();

  const overflowRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (showOverflowMenu && overflowRef.current && !overflowRef.current.contains(e.target)) {
        setShowOverflowMenu(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showOverflowMenu]);

  useEffect(() => {
    if (!autoDraftText) return;
    const matches = autoDraftText.match(/\\[([^\\]\\n]{1,80})\\]/g) || [];
    const counts = {};
    const order = [];
    matches.forEach(m => {
      const tok = m;
      if (!counts[tok]) { counts[tok] = 0; order.push(tok); }
      counts[tok]++;
    });
    setExtractedVariables(order.map(t => ({ token: t, count: counts[t] })));
  }, [autoDraftText]);
`;

// Clean up duplicate vars
top = top.replace(/const \[activeMods, setActiveMods\] = useState\([^)]*\);/g, '');
top = top.replace(/const \[showClearConfirm, setShowClearConfirm\] = useState\([^)]*\);/g, '');
top = top.replace(/const \[showOverflowMenu, setShowOverflowMenu\] = useState\([^)]*\);/g, '');
top = top.replace(/const \[showExportMenu, setShowExportMenu\] = useState\([^)]*\);/g, '');
top = top.replace(/const \[toolbarRef, setToolbarRef\] = useState\([^)]*\);/g, '');
top = top.replace(/const toggleMod = [\s\S]*?(?=const getStatutes)/, '');
top = top.replace(/const getStatutes = [\s\S]*?(?=const statutes)/, '');
top = top.replace(/const statutes = getStatutes\(\);/, '');
top = top.replace(/const overflowRef = useRef\(null\);[\s\S]*?}, \[showOverflowMenu\]\);/, '');

const jsx = fs.readFileSync(path.join(__dirname, 'jsx_part.txt'), 'utf8');
fs.writeFileSync(file, top + stateVars + jsx);
console.log('Update successful!');
