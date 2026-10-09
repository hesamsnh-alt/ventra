// Run in browser DevTools Console while on the project page.
const projectId = location.pathname.split("/projects/")[1]?.split("/")[0];
const estimateKey = `ventra:project-estimate:${projectId}`;
const quoteKey = `ventra:project-quotation:${projectId}`;
console.log("PROJECT", projectId);
console.log("ESTIMATE", JSON.parse(localStorage.getItem(estimateKey) || "null"));
console.log("QUOTATION", JSON.parse(localStorage.getItem(quoteKey) || "null"));
