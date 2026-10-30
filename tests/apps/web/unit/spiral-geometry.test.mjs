import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSpiral, spiralPoint, spiralWindow, spiralPitch} from '../../../../apps/web/src/spiral-geometry.js';

test('Archimedean spiral keeps a constant pitch',()=>{
  const radii=Array.from({length:4},(_,turn)=>spiralPitch/(2*Math.PI)*(turn*2*Math.PI));
  for(let i=1;i<radii.length;i++)assert.ok(Math.abs(radii[i]-radii[i-1]-spiralPitch)<1e-9);
  const first=spiralPoint(0),later=spiralPoint(10);
  assert.deepEqual(first,{x:0,y:0},'A mushroom reaches the exact origin before disappearing');
  assert.ok(Math.hypot(later.x,later.y)>Math.hypot(first.x,first.y));
  for(let position=1;position<20;position++){
    const a=spiralPoint(position),b=spiralPoint(position+1);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>135,'Neighbouring mushroom centres keep generous breathing room');
  }
});

test('spiral curls in the same screen direction as the logo',()=>{
  const fit=fitSpiral(1000,700,20);
  const firstAfterCentre=fit.points[1];
  assert.ok(firstAfterCentre.x>0&&firstAfterCentre.y>0,'Thread starts right and down from the centre');
});

test('workspace-centred origin stays fixed and zoom reveals more or fewer turns',()=>{
  for(const [width,height] of [[320,500],[390,500],[768,600],[1024,700],[1900,700],[800,320]]){
   let previous;
   for(const zoom of [.2,.6,1,1.2,2.4,3.2]){
    const fit=fitSpiral(width,height,width<600?12:20,{},zoom);
    const size=Math.max(zoom<.6?18:28,Math.min(64,fit.scale*118));
    assert.ok(Number.isFinite(fit.scale)&&fit.scale>0);
    assert.equal(fit.x,width/2);assert.equal(fit.y,height/2);assert.equal(fit.angle,0);
    assert.ok(fit.count>=(width<600?12:20));
    const a=spiralPoint(4,fit.angle,fit.nodeArcScale),b=spiralPoint(5,fit.angle,fit.nodeArcScale);
    const screenGap=Math.hypot(a.x-b.x,a.y-b.y)*fit.scale;
    assert.ok(screenGap>fit.nodeSize+(width<600?28:48),'Nodes retain generous screen-space breathing room');
    assert.ok(fit.artNodeSize>=fit.nodeSize,'Artwork circles cannot be smaller than position markers');
    assert.ok(fit.artNodeSize>=(width<600?38:42),'Artwork remains readable on overview camera angles');
    if(previous){
      assert.equal(fit.angle,previous.angle,'Zoom must not rotate the thread');
      assert.ok(fit.turns<previous.turns,'Zooming in removes turns');
      assert.ok(fit.count<=previous.count,'Zooming in cannot add positions');
    }
    assert.ok(fit.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
    assert.ok(fit.visibleTurns<fit.turns,'The source path keeps an invisible tail beyond the viewport');
    assert.ok(fit.visiblePathFraction>0&&fit.visiblePathFraction<1);
    const end=fit.points.at(-1),endRadius=Math.hypot(end.x,end.y)*fit.scale;
    assert.ok(endRadius>Math.hypot(width/2,height/2),'Source thread ends beyond every viewport edge');
    assert.ok(size>0);
    previous=fit;
   }
  }
});

test('a bounded window reaches every position and winds fully into the origin',()=>{
  const total=10006,count=20;
  assert.deepEqual(spiralWindow(total,count,-20),{max:total,offset:0,first:1,last:20});
  const end=spiralWindow(total,count,Infinity);
  assert.equal(end.last,total);assert.equal(end.first,total+1);
  for(const offset of [0,.25,28,4999.5,total]){
    const window=spiralWindow(total,count,offset);
    assert.ok(window.last-window.first+1<=count+1);
  }
  assert.equal(spiralWindow(12,12,100).offset,12);
});
