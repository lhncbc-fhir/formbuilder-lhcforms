
const fhirMock = require('./formbuilder/fhir-mock');

fhirMock('http://hapi.fhir.org').persist();
let app = require('../../server').createFormbuilder(require('../../formbuilder.conf'));
console.log('Starting test server...');
app.start();
