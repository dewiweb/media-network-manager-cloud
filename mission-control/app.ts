import { SSL_OP_TLS_ROLLBACK_BUG } from "constants";
import { kMaxLength } from "buffer";

import { MnMs_node } from "../types/types"

var mdns_ = require('../multicast-dns')
var mdnss = []
var os = require('os');
var sock = require('ws');
var http = require('http')
var exp = require('express')
var fs = require('fs');
var path = require('path')
var _ = require('lodash');
const sdpgetter = require("../rtsp-sdp-query")
const { spawn } = require('child_process');

// Utils
//-------------

function makeid(length) {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
       result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
 }

 function blankMnmsData(d) {
     let out = JSON.parse(JSON.stringify(d))
     out.Switches.forEach((s) => {
        s.Child = null
        s.Timer = null
        s.StartTime = null
     })
     return out
 }
// Options and exports
//--------------------------------

var Options = {
    database: "data.db",
    services_port: 16060,
    clients_port: 8888,
    launch_services: null,
    launch_options: {},
    client_cb: null,
    interfaces: null
}

export = function(LocalOptions) {

    if(!LocalOptions) LocalOptions = {}
    if(LocalOptions.database) Options.database = LocalOptions.database
    if(LocalOptions.services_port) Options.services_port = LocalOptions.services_port
    if(LocalOptions.clients_port) Options.clients_port = LocalOptions.clients_port
    if(LocalOptions.launch_services) Options.launch_services = LocalOptions.launch_services
    if(LocalOptions.launch_options) Options.launch_options = LocalOptions.launch_options
    if(LocalOptions.client_cb) Options.client_cb = LocalOptions.client_cb
    if(LocalOptions.interfaces) Options.interfaces = LocalOptions.interfaces


    // Side connected to other services
    //---------------------------------

    var pc_name = os.hostname()
    var prename = pc_name.split('.')[0];
    var Nodes : MnMs_node[] = [{ Type: "null",
    IP: "",
    id: "0",
    Schema: 1,
    Ports: [],
    Services: {},
    Multicast: null,
    Neighbour: "",
    Mac: ""}]

    var privateKey = fs.readFileSync(path.join(__dirname, 'server.key'), 'utf8');
    var certificate = fs.readFileSync(path.join(__dirname, 'server.cert'), 'utf8');

    var credentials = { key: privateKey, cert: certificate };
    var https = require('https');

    var httpsServer = https.createServer(credentials);
    httpsServer.listen(Options.services_port);

    const wss = new sock.Server({ server: httpsServer })
    wss.on('connection', function connection(ws) {
        console.log("new client connected")
        ws._data = {
            auth : false
        }
        ws.on('message', function incoming(message) {
            let node = JSON.parse(message)
            if(!ws._data.auth && node.Type == "auth") {
                if(node.Challenge == MnmsData.Challenge) {
                    ws._data.auth = true
                    console.log("new client Auth")
                }
                else {
                    console.log(node.Challemge,MnmsData.Challenge)
                }
            } 
            else if(ws._data.auth && node.Type == "switch") {
                let i = Nodes.findIndex(k => k.IP == node.IP);
                let sw = MnmsData.Switches.filter(k => k.UID == node.id)
                if(sw.length == 1) {
                    let t = new Date
                    sw[0].Timer = t.getTime()
                    //console.log(node.id,MnmsData.Switches.filter(k => k.UID == node.id)[0].Timer)
                }
                else {
                    console.log("Could not find id =",node.id)
                }
                if(i == -1) {
                    Nodes.push(
                        {
                            Type: "null",
                            IP: node.IP,
                            id: "0",
                            Schema: 1,
                            Ports: [],
                            Services: {},
                            Multicast: null,
                            Neighbour: "",
                            Mac: ""
                        }
                    )
                    i = Nodes.findIndex(k => k.IP == node.IP);
                }
                mergeNodes(i,node,"")
                calculateInterConnect()
            }
            else {
                console.log("Forbiden",ws._data,node)
            }
        });
    
    });

    
    // Handling MDNS query for mission control
    //------------------
    let mdB = []

    if(Options.interfaces == null)
    {
        mdnss.push(mdns_())
    }
    else {
        Options.interfaces.forEach(i => {
            console.log(i) ; 
            mdnss.push(mdns_({
                multicast: true, // use udp multicasting
                interface: i, // explicitly specify a network interface. defaults to all
                port: 5353, // set the udp port
                ip: '224.0.0.251', // set the udp ip
                ttl: 255, // set the multicast ttl
                loopback: true, // receive your own packets
                reuseAddr: true // set the reuseAddr option when creating the socket (requires node >=0.11.13)
            }))
        })
    }

    var mdnsBrowser_cb = (node) => {
        if(node.Name != null) {
            let i = Nodes.findIndex(k => k.IP == node.IP);
            if(i == -1) {
                Nodes.push(
                    {Name: node.Name,
                    id: "0",
                    Schema: 1,
                    Ports: [],
                    Services: {},
                    Multicast: null,
                    Neighbour: "",
                    Mac: "",
                    IP: node.IP,
                    Type: "null"}
                )
                i = Nodes.findIndex(k => k.Name == node.Name);
            }
            mergeNodes(i,node,node.Name)
        }
    }

    for(var i in mdnss) {
        let mdns = mdnss[i]
        mdns.on('query', (query) => {
            if(query.questions.some(k => k.name == "_missioncontrol._socketio.local")) {

                mdns.respond({
                    answers: [{
                    name: 'missioncontrol_'+prename+'._missioncontrol._socketio.local',
                    type: 'SRV',
                    data: {
                        port:16060,
                        weigth: 0,
                        priority: 10,
                        target: prename+'.local'
                    }
                    }]
                })
            }

        })

        mdns.respond({
            answers: [{
            name: 'missioncontrol_'+prename+'._missioncontrol._socketio.local',
            type: 'SRV',
            data: {
                port:16060,
                weigth: 0,
                priority: 10,
                target: prename+'.local'
            }
            }]
        })
        
        // Browsing services
        //------------------
        mdB.push(require('../mdns-browser')(mdnsBrowser_cb,mdnss[i]))

    }
    // Shaping and linking data
    //-----------

    function mergeNodes(index: number,newValue ,Name: string)
    {
        if(_.isEqual(Nodes[index] , newValue)) return
        if(newValue.Type == "switch") {
            if(newValue.Schema == 1) {
                Nodes[index].Mac = newValue.Mac
                if(Nodes[index].Ports && Nodes[index].Ports.length != newValue.Ports.length) Nodes[index].Ports = []
                Nodes[index].Ports = newValue.Ports
                Nodes[index].Multicast = newValue.Multicast
                Nodes[index].id = newValue.id 
                Nodes[index].Type = newValue.Type 
            }
        }
        if(newValue.Type == "MdnsNode") {
            if(newValue.Schema == 1) {
                if(Nodes[index].Type && Nodes[index].Type != "switch") Nodes[index].Type = newValue.Type
                if(!Nodes[index].Services) Nodes[index].Services = {} 
                if(true) {
                    Object.keys(newValue.Services).forEach((key) => {
                        if(!(Nodes[index].Services[key]) || !(Nodes[index].Services[key].SDP || _.isEqual(Nodes[index].Services[key],newValue.Services[key]))) {
                            console.log("Creating",key)
                            Nodes[index].Services[key] = newValue.Services[key]
                            if(key.includes("_rtsp._tcp")) {
                                sdpgetter("rtsp://" + newValue.IP + ":" + newValue.Services[key].port + "/by-name/" +  encodeURIComponent(key.split("._")[0]),(sdp) => {  if(Nodes[index].Services[key]) Nodes[index].Services[key].SDP = sdp})
                            }
                        }
                    })
                    if(1) {
                        Object.keys(Nodes[index].Services).forEach((key) => {
                            if(!(newValue.Services[key])) {
                                console.log("Deleting",key)
                                delete Nodes[index].Services[key]
                                if(Object.keys(Nodes[index].Services).length == 0) {
                                    if(Nodes[index].Type && Nodes[index].Type != "switch") Nodes[index].Type = "disconnected"
                                }
                            }
                        })
                    }
                }
                Nodes[index].OtherIPs = newValue.OtherIPs
                Nodes[index].Macs = newValue.Macs  
                Nodes[index].Neighbour = newValue.Neighbour
                Nodes[index].Mac = newValue.Mac
                Nodes[index].id = newValue.id
                Nodes[index].Name = Name 
            }
        }
        if(newValue.Type == "disconnected") {
            Nodes[index].Type = "disconnected"
        }
    }

    function calculateInterConnect() {
        var linkd = []
        let conns = [];

        // Detecting interconnect
        for(let i in Nodes) {
            if(Nodes[i].Type == "switch" && Nodes[i].Ports.length > 0) {
                if(!linkd[i]) linkd[i] = {}
                linkd[i].dataRef = i;
                linkd[i].ports = [];
                conns[i] = []
                for(let j : number =0 ; j < Nodes.length ; j++) {
                    if(Nodes[j].Type == "switch" && Nodes[j].Ports.length > 0) {
                        for(let l in Nodes[i].Ports) {
                            if(Nodes[j].Macs && Nodes[i].Ports[l].ConnectedMacs.some(k => Nodes[j].Macs.some(l => l === k))) {
                                if(!linkd[i].ports[l] ) linkd[i].ports[l] = []
                                if(!linkd[i].ports[l].some(k => k == j)) linkd[i].ports[l].push(j);
                            }
                        }
                    }
                }
            }
        }
        //console.log(linkd)

        //console.log(JSON.stringify(linkd.filter(k => k.ports.some(l => l.length == 1))))

        let old_cleared = null;
        while(linkd.some(k => k.ports.some(l => l.length > 1))) {
            let cleared = linkd.filter(k => k.ports.some(l => l.length == 1))
            if(_.isEqual(cleared, old_cleared)) break;
            old_cleared = JSON.parse(JSON.stringify(cleared))
            for(let i in linkd) {
                if(!(cleared.some(k => k.dataRef == linkd[i].dataRef ))) {
                    for(let p in linkd[i].ports) {
                        if(linkd[i].ports[p] != undefined && linkd[i].ports[p].length > 1) {
                            let keep = null;
                            for(let j of linkd[i].ports[p]) {
                                if(cleared.filter(q => q.dataRef == j).length == 1) keep = j;
                            }
                            if(keep != null) {
                                linkd[i].ports[p] = [keep]
                            }
                        }
                    }
                }
            }
        }
    
        // Building connection graph
        for(let i in Nodes) {
            //if(Nodes[i].Mac) console.log(Nodes[i].Mac)
            if(Nodes[i].Type == "switch" && Nodes[i].Ports.length > 0) {
                let connlist = linkd.filter(k => k.dataRef == i)[0];
            // console.log(connlist)
                for(let p in Nodes[i].Ports) {
                    if(connlist.ports[p]) {
                        Nodes[i].Ports[p].Neighbour=Nodes[connlist.ports[p][0]].IP
                    }
                    else if(Nodes[i].Ports[p].ConnectedMacs.length == 1){
                        let d = Nodes.filter(k => k.Macs && k.Macs.some(l => l === Nodes[i].Ports[p].ConnectedMacs[0]))
                //       console.log("size 1 : " + Nodes[i].Ports[p].ConnectedMacs[0] + " : d size " + d.length + " N->" + Nodes[i].Ports[p].Neighbour)
                        if(d.length >= 1)
                            Nodes[i].Ports[p].Neighbour=d[0].IP
                    }
                // console.log(Nodes[i].Ports[p].Neighbour)
                }
            }
        }

        //console.log(JSON.stringify(linkd.filter(k => k.ports.some(l => l.length == 1))))
    }


    // User and GUI side
    //------------------

    const user_app = exp();

    const server = http.createServer(user_app);

    user_app.use('/', exp.static(__dirname + '/html'));

    server.listen(Options.clients_port, () => {
        console.log(`Server started on port ` + Options.clients_port + ` :)`);
    });

    const user_wss = new sock.Server({ server: server });

    user_wss.on('connection', (ws) => {

        ws.on('message', (message: string) => {
            if(message == "nodes") {
                ws.send(JSON.stringify(Nodes));
            }
            else if(message == "data") {
                let t = new Date;
                MnmsData.CurrentTime = t.getTime()
                ws.send(JSON.stringify(MnmsData))
            }
            else {
                try {
                    let D = JSON.parse(message)
                    console.log("D" ,D)
                    if(D.Type && D.Type == "ciscoSG") {
                        if(!MnmsData.Switches.some(k => k.IP == D.IP)) {
                            MnmsData.Switches.push({
                                Type: D.Type,
                                IP: D.IP,
                                Child: null,
                                Timer: null,
                                StartTime: null,
                                UID: "ddjt" + Date.now() + ((encodeURIComponent(D.IP)))
                            })
                            db.update({Type: "MnmsData"},blankMnmsData(MnmsData), {upsert: true},(err, newDoc) => { })
                            console.log(MnmsData)
                        }
                    }
                } catch (error) {
                    console.log("Error when parsing json on message reception")
                }
            }
        });

        //send immediatly a feedback to the incoming connection    
        ws.send(JSON.stringify(MnmsData))
        ws.send(JSON.stringify(Nodes))
    });


    // db and other services start
    //------------------
    var MnmsData = {
        Type: "MnmsData",
        Workspace: "Mnms - Network Name",
        CurrentTime: 0,
        Challenge: makeid(20),
        OkSwitches: 0,
        Switches : []
    }

    var Datastore = require('nedb')
    , db = new Datastore({ filename: path.join(__dirname, Options.database), autoload: true });
    db.find({ Type: "MnmsData"}, (err, docs) => {
        console.log(docs)
        if(docs.length==1) {
            MnmsData = docs[0]
        }
    })
    
    var ServicesDirectory = {
        cisco_switch: "../cisco-switch/app.js"
    }

    var serviceLauncher = (ServiceOptions) => {
        let child_info
        if(Options.launch_services) {
            child_info = Options.launch_services(ServiceOptions)
        }
        else {
            let type = ServiceOptions.Name.split(":")[0]
            let action = ServiceOptions.Name.split(":")[1]
            if(action == "start") {
                child_info = spawn("node",[ServicesDirectory[type],"-i",ServiceOptions.Params.IP,"-k",MnmsData.Challenge,"-y",ServiceOptions.UID ])
                child_info.on("error",() => {
                    child_info.kill()
                })
            }
            else if(action == "stop") {
                if(ServiceOptions.Params.Child.kill) ServiceOptions.Params.Child.kill()
                child_info = null;
            }
        }
        return child_info
    }

    var watchDog = () => {
        console.log("Waf waf")
        let now = Date.now()
        let okswitches = 0, instart = 0;
        for(let s in MnmsData.Switches ){
            if(MnmsData.Switches[s].Child) {
                if(now - MnmsData.Switches[s].Timer < 10000)
                    okswitches++
                else if(now - MnmsData.Switches[s].StartTime < 15000)
                    instart++
                else 
                    MnmsData.Switches[s].Child = serviceLauncher({
                        Name : "cisco_switch:stop",
                        Params:{Child : MnmsData.Switches[s].Child},
                        Challenge: MnmsData.Challenge, 
                        UID: MnmsData.Switches[s].UID
                    })
            }
            else {
                MnmsData.Switches[s].StartTime = Date.now()
                MnmsData.Switches[s].Child = "starting"
                MnmsData.Switches[s].Child = serviceLauncher({
                    Name : "cisco_switch:start",
                    Params:{IP : MnmsData.Switches[s].IP},
                    Challenge: MnmsData.Challenge, 
                    UID: MnmsData.Switches[s].UID
                })
            }
        }
        MnmsData.OkSwitches = okswitches
    }

    setInterval( watchDog, 2000 )
}