//import "src/aurora.coffee"
//import "src/sources/node/http.coffee"
//import "src/sources/node/file.coffee"
//import "src/devices/node-speaker.coffee"

AV.isNode = true;
AV.require = function(...modules) {
    let Module = require('module');
    
    // create a temporary reference to the AV namespace 
    // that we can access from within the required modules
    let key = `__AV__${Date.now()}`;
    Module.prototype[key] = AV;
    
    // temporarily override the module wrapper
    let wrapper = Module.wrapper[0];
    Module.wrapper[0] += `var AV = module['${key}'];`;
    
    // require the modules
    for (let module of Array.from(modules)) {
        require(module);
    }
        
    // replace the wrapper and delete the temporary AV reference
    Module.wrapper[0] = wrapper;
    delete Module.prototype[key];
    
};

export default AV;