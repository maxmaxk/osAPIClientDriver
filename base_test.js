const net = require('net');
const server = net.createServer((socket) => {
  console.log("connected");
  socket.on('error',(e)=>{
    console.log("error "+e);
    server.close();
    server.listen(9005);
  });
  socket.on('data',(data)=>{
    console.log("data: ",data.toString());
  });
});

server.listen(9005);

const tls = require('tls'),
fs = require('fs');

let options = {
  key: fs.readFileSync('demo.key'),
  cert: fs.readFileSync('demo.crt')
};
let transID = 0;
const tlsServer = tls.createServer(options, (socket) => {
  console.log("tls connected");
  transID = 0;
  socket.on('error',(e)=>{
    console.log("tls error "+e);
    tlsServer.close();
    tlsServer.listen(9006);
  });
  socket.on('data',(data)=>{
    console.log("tlsdata: ",data.toString());
    transID++;
    if(transID == 1) socket.write('{"cmd":"pingDriver", "uid":"1234", "transID": '+transID+'}');
    if(transID == 2) socket.write('{"cmd":"getNodes", "transID": '+transID+'}');
    if(transID == 3) socket.write('{"cmd":"pingNode", "uid":"1", "transID": '+transID+'}');
    if(transID == 4) socket.write('{"cmd":"getNode", "uid":"1", "transID": '+transID+'}');
    if(transID == 5) socket.write('{"cmd":"setNode", "uid":"1", "name":"ModbusNode", "transID": '+transID+', "options":[{"modbusVarType":"InputRegister"}]}');
    if(transID == 6) socket.write('{"cmd":"addNode", "transID": '+transID+', "name":"newNode", "options":[{"modbusHost": "testhost"},{"modbusPort":502},{"modbusVarType":"HoldingRegister"}]}');
    if(transID == 7) socket.write('{"cmd":"deleteNode", "transID": '+transID+', "uid":["4"]}');
    if(transID == 8) socket.write('{"cmd":"getDevices", "transID": '+transID+'}');
    if(transID == 9) socket.write('{"cmd":"getDevices", "uid":"1", "transID": '+transID+'}');
    if(transID == 10) socket.write('{"cmd":"pingDevice", "uid":"1", "transID": '+transID+'}');
    if(transID == 11) socket.write('{"cmd":"getDevice", "uid":"1", "transID": '+transID+'}');
    if(transID == 12) socket.write('{"cmd":"getDevice", "transID": '+transID+'}');
    if(transID == 13) socket.write('{"cmd":"setDevice", "uid":"1", "transID": '+transID+', "name":"Modbus device 1xx", "options":[{"modbusId":1}]}');
    if(transID == 14) socket.write('{"cmd":"addDevice", "transID": '+transID+', "name":"Modbus device 3", "options":[{"modbusId":3}]}');
    if(transID == 15) socket.write('{"cmd":"deleteDevice", "transID": '+transID+', "uid":["4"]}');
    if(transID == 16) socket.write('{"cmd":"getNode", "transID": '+transID+'}');
    if(transID == 17) socket.write('{"cmd":"getTags", "deviceUid":"3", "isOptions":true, "transID": '+transID+'}');
    if(transID == 18) socket.write('{"cmd":"getTag", "deviceUid":"1", "uid":"0", "transID": '+transID+'}');
    if(transID == 19) socket.write('{"cmd":"setTag", "deviceUid":"1", "uid":"0", "name":"HoldReg222", "transID": '+transID+', "options":[{"modbusVarType":"HoldingRegister"}]}');
    if(transID == 20) socket.write('{"cmd":"getTag", "deviceUid":"3", "transID": '+transID+'}');
    //if(transID == 21) socket.write('{"cmd":"addTag", "deviceUid":"1", "address":3, "type":"int", "read": false, "write": true,"transID": '+transID+', "name":"newTag", "options":[{"modbusVarType":"Coil"},{"modbusVarAddress":10}]}');
  //  if(transID == 22) socket.write('{"cmd":"deleteTag", "deviceUid":"1", "uid":["3","4","5","6","7","8","9","10","11","12","13","14"], "transID": '+transID+'}');
    if(transID == 21){
      socket.write('{"cmd":"getTagsValues", "transID": '+transID++ +', "deviceUid":"1", "tags":["4","5"]}\n');
    //  socket.write('{"cmd":"getTagsValues", "transID": '+transID++ +', "deviceUid":"1", "tags":["4","5"]}\n');
    //  socket.write('{"cmd":"getTagsValues", "transID": '+transID++ +', "deviceUid":"1", "tags":["4","5"]}\n');
    //  socket.write('{"cmd":"getTagsValues", "transID": '+transID+', "deviceUid":"2", "tags":["1"]}');
    }
    if(transID == 22) socket.write('{"cmd":"setTagsValues", "transID": '+transID++ +', "deviceUid":"1", "tags":[{"4": 1}, {"5": 0}]}\n');
    if(transID == 23) socket.write('{"cmd":"setTagsSubscribe", "transID": '+transID++ +', "deviceUid":"1", "tags":["0","4"]}');
    dataObj = JSON.parse(data.toString());
    if(dataObj.cmd == 'asyncTagsValues'){
      socket.write('{"cmd":"asyncTagsValues", "transID":0}');
    }

  });
});

tlsServer.listen(9006);
