import { specimensPanel } from '../renderer/ui/panel-specimens.js';
const api = { getSpecimenCatalog: window.testCatalog, getSpecimenData: window.testBundle,
  getSpecimenCell: window.testCell, getSpecimenPath: window.testPath,
  getSpecimenMorphology: window.testMorphology, openExternal() {} };
window.flyAPI = api;
window.specimenView = specimensPanel.build({ api, state: {}, save(_kind, value) { window.lastExport = value; } });
document.getElementById('fixture').append(window.specimenView.el);
