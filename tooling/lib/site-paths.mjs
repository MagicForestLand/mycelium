// Source placement is independent of the public site's URL contract.
// The static export emits these conventional paths without an apps/web/ prefix.
export function siteSourcePath(pathname){
  const file=pathname==='/'?'index.html':pathname.replace(/^\//,'');
  if(['index.html','chain-config.json','mycelium.bundle.js'].includes(file)||file.startsWith('assets/'))return 'apps/web/'+file;
  return file;
}
