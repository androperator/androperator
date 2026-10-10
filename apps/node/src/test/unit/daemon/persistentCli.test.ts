import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { createServeApp } from "../../../cli/commands/serve.js";
import { COMMANDS } from "../../../cli/registry.js";
import { getCliBuildIdentity, getCliVersion } from "../../../domain/version/cliIdentity.cjs";
import { tryPersistentCli, type PersistentCliClientDeps } from "../../../cli/persistentCliClient.cjs";
import { handlePersistentCli } from "../../../cli/persistentCliServer.js";
import { cliEnvironmentIdentity } from "../../../cli/persistentCliProtocol.cjs";
import { persistentCliContext } from "../../../domain/executions/persistentCliContext.js";
import { runCli, type CliIo } from "../../../cli/runner.js";
import { tryDaemonExecution } from "../../../cli/daemonProxy.js";

const buildIdentity = getCliBuildIdentity();
const argv = ["snapshot", "--max-nodes", "invalid"];
function request(overrides: object = {}): object {
  return {requestId: randomUUID(), argv, cwd: process.cwd(), environment: cliEnvironmentIdentity(), buildIdentity, ...overrides};
}
function io(): CliIo & {stdout: string; errors: string} {
  return {stdout:"",errors:"",exitCode:0,starHints:false,
    log(text) { this.stdout += text + "\n"; }, error(text) { this.errors += text + "\n"; },
    stderr(text) { this.errors += text; }};
}
function deps(post: NonNullable<PersistentCliClientDeps["request"]>): PersistentCliClientDeps {
  return {owned: async () => true, socketPath: () => "/unused", request: async (socket, method, route, payload) => method === "GET"
    ? {status:200,body:JSON.stringify({persistentCli:1,buildIdentity,version:getCliVersion()})} : post(socket,method,route,payload)};
}

describe("persistent CLI routing and no replay", () => {
  it("returns the exact request-scoped output", async () => {
    const result = await tryPersistentCli(argv, deps(async (_s,_m,_r,payload) => {
      const body = await handlePersistentCli(JSON.parse(payload!), undefined);
      return {status:200,body:JSON.stringify(body)};
    }));
    const local = io(); await runCli(argv,local);
    assert.deepEqual(result,{stdout:local.stdout,stderr:local.errors,exitCode:local.exitCode});
  });
  it("declines old or unowned daemons without POST", async () => {
    let posts=0;
    const result = await tryPersistentCli(argv,{owned:async()=>false,request:async()=>{posts++;throw Error();}});
    assert.equal(result,null);assert.equal(posts,0);
    assert.equal(await tryPersistentCli(argv,{owned:async()=>true,request:async()=>({status:200,body:'{}'})}),null);
  });
  it("falls back only on correlated pre-dispatch declines or a failed connection", async () => {
    assert.equal(await tryPersistentCli(argv,deps(async (_s,_m,_r,payload)=>({status:200,body:JSON.stringify({kind:'declined',requestId:JSON.parse(payload!).requestId})}))),null);
    assert.equal(await tryPersistentCli(argv,deps(async()=>{throw Object.assign(Error('connect'),{connected:false});})),null);
  });
  it("never retries missing, truncated, mismatched or uncertain responses", async () => {
    for(const mode of ['lost','truncated','wrong-id','server-error']) {
      let calls=0;
      const result=await tryPersistentCli(argv,deps(async()=>{calls++;if(mode==='lost')throw Object.assign(Error('lost'),{connected:true});return {status:mode==='server-error'?500:200,body:mode==='truncated'?'{':JSON.stringify({kind:'declined',requestId:'wrong'})};}));
      assert.equal(calls,1);assert.equal(result?.exitCode,1);assert.match(result!.stdout,/DAEMON_PROXY_ERROR/);assert.match(result!.stdout,/unknown/);
    }
  });
  it("keeps opt-out, help, global-prefix and custom timeout invocations local", async () => {
    for(const args of [['snapshot','--no-daemon'],['snapshot','--help'],['--device','d','snapshot'],['snapshot','--timeout','40000']]) {
      assert.equal(await tryPersistentCli(args,{owned:async()=>{throw Error('must not probe');}}),null);
    }
  });
});

describe("persistent CLI request isolation", () => {
  it("declines mismatched caller state and unsupported commands before execution", async () => {
    for(const overrides of [{cwd:'/different'}, {environment:'different'}, {deviceId:'other'}, {buildIdentity:{}}, {argv:['daemon','stop']}, {argv:['snapshot','--device','other']}, {runId:'bad run'}, {logDir:1}]) {
      assert.equal((await handlePersistentCli(request(overrides),undefined) as {kind:string}).kind,'declined');
    }
  });
  it("keeps concurrent output, exit status and async execution context separate", async () => {
    const savedArgv=process.argv, savedCwd=process.cwd(), savedExit=process.exitCode, savedEnv=JSON.stringify({...process.env});
    const [first,second] = await Promise.all([
      handlePersistentCli(request(),undefined), handlePersistentCli(request({argv:['snapshot','--not-a-flag']}),undefined),
    ]) as Array<{stdout:string;exitCode:number}>;
    assert.match(first.stdout,/max-nodes/);assert.match(second.stdout,/not-a-flag/);
    assert.equal(first.exitCode,1);assert.equal(second.exitCode,1);
    assert.equal(process.argv,savedArgv);assert.equal(process.cwd(),savedCwd);assert.equal(process.exitCode,savedExit);assert.equal(JSON.stringify({...process.env}) === savedEnv,true,"Environment changed");
    const seen = await Promise.all(['a','b'].map(label => persistentCliContext.run({warn:()=>{}}, async () => {
      const context=persistentCliContext.getStore();await new Promise(r=>setTimeout(r,1));
      assert.equal(persistentCliContext.getStore(),context);
      assert.equal(await tryDaemonExecution({}, {}, {isDaemonAliveFn:async()=>{throw Error('recursive proxy');}}),null);
      return label;
    })));
    assert.deepEqual(seen,['a','b']);assert.equal(persistentCliContext.getStore(),undefined);
  });
});


describe("persistent CLI live protocol", () => {
  it("only exposes CLI forwarding on explicitly enabled daemon servers", async () => {
    for (const daemonCli of [false, true]) {
      const app = createServeApp({ verbose: false, daemonCli });
      const server = await new Promise<http.Server>(resolve => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      });
      try {
        const address = server.address() as { port: number };
        const base = `http://127.0.0.1:${address.port}`;
        const version = await (await fetch(base + "/version")).json() as { persistentCli?: number };
        assert.equal(version.persistentCli, daemonCli ? 1 : undefined);
        const response = await fetch(base + "/cli", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request()) });
        assert.equal(response.status, daemonCli ? 200 : 404);
        if (daemonCli) assert.equal((await response.json() as { kind: string }).kind, "completed");
      } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  });
  it("does not resend when a real socket closes after receiving the POST", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daemon-cli-wire-"));
    const socketPath = join(directory, "socket");
    let posts = 0;
    const server = http.createServer((req,res) => {
      if(req.url === "/version") { res.end(JSON.stringify({persistentCli:1,buildIdentity,version:getCliVersion()})); return; }
      posts++;
      req.resume(); req.on("end",()=>req.socket.destroy());
    });
    await new Promise<void>(resolve=>server.listen(socketPath,resolve));
    try {
      const result = await tryPersistentCli(argv,{owned:async()=>true,socketPath:()=>socketPath});
      assert.equal(result?.exitCode,1);assert.match(result!.stdout,/DAEMON_PROXY_ERROR/);assert.equal(posts,1);
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true}); }
  });
  it("isolates interleaved handler logs, run IDs, output and warnings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "daemon-cli-context-"));
    const original = COMMANDS.snapshot.handler;
    COMMANDS.snapshot.handler = async ctx => {
      const label = ctx.rest[1];
      await new Promise(resolve=>setTimeout(resolve,label === "one" ? 5 : 1));
      persistentCliContext.getStore()!.warn(label + " warning\n");
      ctx.logger.emit({ts:new Date().toISOString(),level:"info",event:"test",message:label});
      return JSON.stringify({label,logPath:ctx.logger.logPath()});
    };
    try {
      const responses = await Promise.all(["one","two"].map(label => handlePersistentCli(request({
        argv:["snapshot","--max-nodes",label],runId:` ${label} `,logDir:join(directory,label),
      }),undefined))) as Array<{stdout:string;stderr:string;exitCode:number}>;
      // Use a selector-free flag that passes parsing before the mocked handler.
      for (let i=0;i<responses.length;i++) {
        const label=["one","two"][i];const response=responses[i];
        assert.equal(response.exitCode,0);assert.equal(response.stderr,label+" warning\n");
        const value=JSON.parse(response.stdout);assert.equal(value.label,label);
        const events=(await readFile(value.logPath,"utf8")).trim().split("\n").map(line=>JSON.parse(line));
        assert.ok(events.every(event=>event.runId===label));
      }
    } finally {COMMANDS.snapshot.handler=original;await rm(directory,{recursive:true,force:true});}
  });
});
