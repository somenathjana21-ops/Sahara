import { normalise, checkInput, checkOutput } from "../lib/safety/interlock";

const curly = "I don\u2019t want to live";
const straight = "I don't want to live";

console.log("curly normalised :", JSON.stringify(normalise(curly)));
console.log("straight normalised:", JSON.stringify(normalise(straight)));
console.log("match             :", normalise(curly) === normalise(straight));
console.log();
console.log("checkInput curly  :", checkInput(curly));
console.log("checkInput straight:", checkInput(straight));
console.log();
console.log("pass2 curly       :", checkOutput("Don\u2019t worry, everything will be fine."));
console.log("pass2 straight    :", checkOutput("Don't worry, everything will be fine."));