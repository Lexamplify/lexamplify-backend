const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'components', 'AutoDraftWorkspace.jsx');
let content = fs.readFileSync(file, 'utf8');

// The block we injected at the bottom:
const stateVarsBlockStart = `  const [activeMods, setActiveMods] = useState({ cure: false, feecap: false, seat: false, carveout: false });`;
const stateVarsBlockEnd = `  return (`;

const splitIdx1 = content.indexOf(stateVarsBlockStart);
if (splitIdx1 === -1) {
    console.log("Could not find stateVars block start");
    process.exit(1);
}
const splitIdx2 = content.indexOf(stateVarsBlockEnd, splitIdx1);
if (splitIdx2 === -1) {
    console.log("Could not find stateVars block end");
    process.exit(1);
}

// Extract the injected state vars block
const stateVars = content.substring(splitIdx1, splitIdx2);

// Remove it from the bottom
content = content.substring(0, splitIdx1) + content.substring(splitIdx2);

// Inject it at the top, right after extractedVariables
const targetAnchor = `const [extractedVariables, setExtractedVariables] = useState([]);`;
const targetIdx = content.indexOf(targetAnchor);
if (targetIdx === -1) {
    console.log("Could not find target anchor");
    process.exit(1);
}

const insertionPoint = targetIdx + targetAnchor.length + 1; // +1 for newline

content = content.substring(0, insertionPoint) + '\n' + stateVars + '\n' + content.substring(insertionPoint);

fs.writeFileSync(file, content);
console.log("Successfully moved stateVars to the top!");
