const {test}=require('node:test'),assert=require('node:assert/strict');
const {semantic,visual,contextKey}=require('../../examples/skills/utils/settings_render_condition');
const snapshot=(nodes, extra={})=>({envelope:{status:'success',stepResults:[{actionType:'snapshot',success:true,data:{foreground_package:'com.android.settings',has_overlay:'false',window_count:'1',...extra}}]},compact:{truncated:false,nodes:nodes.map((text,i)=>({text,visibleToUser:true,bounds:'[0,0][10,10]',nodePath:String(i)}))}});
test('title row in the old list cannot pass visual arrival; content needs independent pixels',()=>{
 assert.equal(visual([{text:'About phone',confidence:1,top:0.8}],['About phone']),false);
 const header={text:'About phone',confidence:1,top:0.1};
 assert.equal(visual([header],['About phone','Build number']),false);
 assert.equal(visual([header,{text:'Build number',confidence:1,top:0.8}],['About phone','Build number']),true);
});
test('semantic condition requires visible rows and safe complete foreground evidence',()=>{
 assert.equal(semantic(snapshot(['About phone']),['About phone','Build number']),false);
 assert.equal(semantic(snapshot(['About phone','Build number']),['About phone','Build number']),true);
 assert.equal(semantic(snapshot(['About phone'],{foreground_package:'other'}),['About phone']),false);
 assert.throws(()=>semantic(snapshot(['About phone'],{has_overlay:'true'}),['About phone']));
 const s=snapshot(['About phone']);s.compact.truncated=true;assert.throws(()=>semantic(s,['About phone']));
});
test('context detects relevant movement and geometry but ignores unrelated text',()=>{
 const a=snapshot(['Device name','unrelated']);const key=contextKey(a,['About phone'],{rotation:0});
 const b=snapshot(['Device name','changed']);assert.equal(contextKey(b,['About phone'],{rotation:0}),key);
 b.compact.nodes[0].bounds='[1,1][10,10]';assert.notEqual(contextKey(b,['About phone'],{rotation:0}),key);
 assert.notEqual(contextKey(a,['About phone'],{rotation:1}),key);
});

test('painted but inaccessible heading needs independent visible page content',()=>{
 const s=snapshot(['About phone','Basic info','Device name']);
 s.compact.nodes[0].visibleToUser=false;s.compact.nodes[0].bounds='[210,210][210,281]';
 assert.equal(semantic(s,['About phone']),true);
 assert.equal(visual([{text:'About phone',confidence:1,top:0.8}],['About phone']),false);
 s.compact.nodes[2].visibleToUser=false;
 assert.equal(semantic(s,['About phone']),false);
 assert.equal(semantic(snapshot(['Build number']),['About phone','Build number']),true);
});
