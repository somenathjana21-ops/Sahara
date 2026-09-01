// components/ui/crisis.test.ts — T2-B1/B2/B3 render test
//
// Validates that CrisisPanel is a synchronous function component that
// returns JSX without requiring any async/await or waitFor.
// Uses Node's built-in test runner (no @testing-library needed).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { CrisisPanel } from "./CrisisPanel";

describe("CrisisPanel", () => {
  it("exports a function (not an async function)", () => {
    assert.equal(typeof CrisisPanel, "function");
    // AsyncFunction has constructor.name === 'AsyncFunction'.
    // CrisisPanel must be synchronous — no waitFor needed.
    assert.notEqual(
      CrisisPanel.constructor.name,
      "AsyncFunction",
      "CrisisPanel must be a synchronous function component, not async"
    );
  });

  it("renders synchronously when called with valid props (returns non-null JSX)", () => {
    const resources = [
      { label: "NHAA — National Helpline Against Atrocities", phone: "14566" },
      { label: "Tele-MANAS — Mental health support", phone: "14416" },
    ];

    // Calling the component function directly returns a React element.
    // This is the synchronous render test: no await, no waitFor.
    const element = CrisisPanel({
      resources,
      onTalkToPerson: () => {},
    });

    assert.ok(element, "CrisisPanel must return a non-null element");
    assert.equal(typeof element, "object", "Return value must be a JSX element (object)");
    // React elements have a $$typeof symbol or a type property.
    assert.ok(
      "type" in element || "props" in element,
      "Return value must look like a React element"
    );
  });

  it("renders resources passed as props, not from a hardcoded constant", () => {
    const customResources = [
      { label: "Test Helpline", phone: "99999" },
    ];

    const element = CrisisPanel({
      resources: customResources,
      onTalkToPerson: () => {},
    });

    // Traverse the element tree to find the phone number.
    // React elements are { type, props: { children, ... } }.
    const json = JSON.stringify(element);
    assert.ok(
      json.includes("99999"),
      "CrisisPanel must render the resources passed as props"
    );
    assert.ok(
      json.includes("Test Helpline"),
      "CrisisPanel must render the label from props"
    );
  });
});
