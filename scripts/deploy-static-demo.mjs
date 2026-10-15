import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "outputs");
const awsExe = process.env.AWS_CLI_PATH || "aws.exe";
function aws(args, json = true) {
  const result = spawnSync(awsExe, [...args, "--no-cli-pager", ...(json ? ["--output", "json"] : [])], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || result.stdout);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
const build = JSON.parse(await readFile(path.join(output, "static-demo-build.json"), "utf8"));
const bucket = "policycompass-3d-demo";
const release = `policycompass-static/releases/${new Date().toISOString().replace(/[:.]/g, "-")}`;
const functionName = "policycompass-static-demo";
const functionFile = path.join(output, "static-demo-router.js");
const router = `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('/api/') === 0) return request;
  if (request.uri.endsWith('/')) request.uri += 'index.html';
  else if (request.uri.split('/').pop().indexOf('.') === -1) request.uri += '/index.html';
  return request;
}`;
await writeFile(functionFile, router);
let previousFunction;
try { previousFunction = aws(["cloudfront", "describe-function", "--name", functionName]); }
catch (error) { if (!error.message.includes("NoSuchFunctionExists")) throw error; }
const fn = aws(["cloudfront", previousFunction ? "update-function" : "create-function", "--name", functionName, ...(previousFunction ? ["--if-match", previousFunction.ETag] : []), "--function-config", JSON.stringify({ Comment: "PolicyCompass static demo clean URLs", Runtime: "cloudfront-js-2.0" }), "--function-code", `fileb://${functionFile}`]);
const published = aws(["cloudfront", "publish-function", "--name", functionName, "--if-match", fn.ETag]);
console.log("Uploading isolated release", release);
console.log(aws(["s3", "sync", build.directory, `s3://${bucket}/${release}/`, "--region", "ap-northeast-2", "--cache-control", "public,max-age=300", "--only-show-errors"], false));
// Explicit MIME type for extensionless JSON status documents.
for (const endpoint of ["clinical-copilot", "medication-claim-review", "patient-question-assistant"]) {
  const statusFile = path.join(build.directory, "api", endpoint, "status");
  await readFile(statusFile);
  aws(["s3", "cp", statusFile, `s3://${bucket}/${release}/api/${endpoint}/status`, "--content-type", "application/json; charset=utf-8", "--cache-control", "public,max-age=300", "--only-show-errors"], false);
}
const config = {
  CallerReference: release,
  Comment: "PolicyCompass S3 static demo (AI API disabled)",
  Enabled: true, DefaultRootObject: "index.html", PriceClass: "PriceClass_200",
  Origins: { Quantity: 1, Items: [{ Id: "static-demo-s3", DomainName: `${bucket}.s3.ap-northeast-2.amazonaws.com`, OriginPath: `/${release}`, S3OriginConfig: { OriginAccessIdentity: "" } }] },
  DefaultCacheBehavior: {
    TargetOriginId: "static-demo-s3", ViewerProtocolPolicy: "redirect-to-https",
    TrustedSigners: { Enabled: false, Quantity: 0 }, TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
    Compress: true, CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
    FunctionAssociations: { Quantity: 1, Items: [{ EventType: "viewer-request", FunctionARN: published.FunctionSummary.FunctionMetadata.FunctionARN }] },
    ResponseHeadersPolicyId: "67f7725c-6f97-4210-82d7-5512b31e9d03",
  },
  ViewerCertificate: { CloudFrontDefaultCertificate: true },
  Restrictions: { GeoRestriction: { RestrictionType: "none", Quantity: 0 } },
  HttpVersion: "http2and3", IsIPV6Enabled: true,
};
const configPath = path.join(output, "static-demo-cloudfront.json");
await writeFile(configPath, JSON.stringify(config));
let previousDeployment;
try { previousDeployment = JSON.parse(await readFile(path.join(output, "static-demo-deployment.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
let created;
if (previousDeployment) {
  const previous = aws(["cloudfront", "get-distribution-config", "--id", previousDeployment.distributionId]);
  previous.DistributionConfig.Origins.Items[0].OriginPath = `/${release}`;
  await writeFile(configPath, JSON.stringify(previous.DistributionConfig));
  created = aws(["cloudfront", "update-distribution", "--id", previousDeployment.distributionId, "--if-match", previous.ETag, "--distribution-config", `file://${configPath}`]);
} else {
  created = aws(["cloudfront", "create-distribution", "--distribution-config", `file://${configPath}`]);
}
const manifest = { bucket, release, distributionId: created.Distribution.Id, url: `https://${created.Distribution.DomainName}`, directory: build.directory, builtAt: build.builtAt };
await writeFile(path.join(output, "static-demo-deployment.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
