// Classical Archimedean spiral: every full turn adds the same radial distance.
export const spiralPitch=300;
const spiralRadiusPerRadian=spiralPitch/(2*Math.PI);
const nodeArcGap=160;

function spiralArcLength(theta){
  return spiralRadiusPerRadian*.5*(theta*Math.hypot(1,theta)+Math.asinh(theta));
}
function thetaAtArcLength(length){
  let theta=Math.sqrt(Math.max(0,2*length/spiralRadiusPerRadian));
  for(let i=0;i<7;i++)theta-=(spiralArcLength(theta)-length)/(spiralRadiusPerRadian*Math.hypot(1,theta));
  return Math.max(0,theta);
}
function spiralCoordinates(theta,angle=0){
  const radius=spiralRadiusPerRadian*theta,phase=theta+angle;
  // Match the brand mark: from the centre the thread begins to the right and
  // curls downward in SVG's coordinate system.
  return {x:radius*Math.cos(phase),y:radius*Math.sin(phase)};
}
export function spiralPoint(position,angle=0,arcScale=1){
  return spiralCoordinates(thetaAtArcLength(Math.max(0,position)*nodeArcGap*arcScale),angle);
}

// The camera scale depends only on the workspace, never on how many mushrooms
// must fit. Positions may leave the viewport and return as they move along the
// thread; this lets the visible mushrooms stay large.
export function fitSpiral(width,height,referenceCount,insets={},zoom=1){
  const x=width/2,y=height/2;
  const bounds={left:0,right:width,top:0,bottom:height};
  const baseScale=Math.max(.32,Math.min(1.35,Math.min(width,height)/950));
  const scale=baseScale*zoom,points=[{x:0,y:0}];
  const narrow=width<600;
  const nodeSize=Math.max(zoom<.6?24:narrow?48:68,Math.min(narrow?72:108,scale*88));
  // At wide camera angles the thread still uses compact position markers, but
  // artwork needs a larger visual floor to remain recognizable.
  const artNodeSize=Math.max(nodeSize,narrow?38:42);
  const nodePixelGap=nodeSize+(narrow?38:60);
  // Keep the visual distance between neighbours useful at every camera scale.
  // This fills the visible turns instead of leaving only a few tiny mushrooms
  // near the origin when the camera is close.
  const nodeArcScale=nodePixelGap/(scale*nodeArcGap);
  const farthestCorner=Math.hypot(Math.max(x,width-x),Math.max(y,height-y));
  const visibleTheta=farthestCorner/(spiralRadiusPerRadian*scale);
  // The source path always ends outside the viewport's circumscribed circle.
  // CSS clips it at the workspace edge, so zoom behaves like a camera and can
  // never reveal the artificial end of the spiral.
  const pathEnd=visibleTheta+Math.max(2,Math.max(width,height)*.15/(spiralRadiusPerRadian*scale));
  for(let theta=.02;theta<=pathEnd;theta+=.02){
    points.push(spiralCoordinates(theta));
  }
  points.push(spiralCoordinates(pathEnd));
  const availableArc=spiralArcLength(visibleTheta)/nodeArcScale;
  const count=Math.max(referenceCount,Math.min(600,Math.floor(availableArc/nodeArcGap)));
  return {x,y,angle:0,scale,points,count,turns:pathEnd/(2*Math.PI),visibleTurns:visibleTheta/(2*Math.PI),visiblePathFraction:spiralArcLength(visibleTheta)/spiralArcLength(pathEnd),bounds,nodeSize,artNodeSize,nodeArcScale};
}

export function spiralWindow(total, count, offset) {
  // The final slider position winds the final mushroom into the origin. A node
  // leaves the browsing window only after physically reaching that point.
  const max = Math.max(0, total), start = Math.max(0, Math.min(max, offset));
  return {max, offset: start, first: Math.floor(start) + 1, last: Math.min(total, Math.ceil(start + count))};
}
