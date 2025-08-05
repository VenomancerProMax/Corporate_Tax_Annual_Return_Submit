let app_id, account_id;
let cachedFile = null;
let cachedBase64 = null;

ZOHO.embeddedApp.on("PageLoad", async (entity) => {
  try {
    const entity_id = entity.EntityId;
    const appResponse = await ZOHO.CRM.API.getRecord({
      Entity: "Applications1",
      approved: "both",
      RecordID: entity_id,
    });
    const applicationData = appResponse.data[0];
    app_id = applicationData.id;
    account_id = applicationData.Account_Name.id;

    const accountResponse = await ZOHO.CRM.API.getRecord({
      Entity: "Accounts",
      approved: "both",
      RecordID: account_id,
    });
    const accountData = accountResponse.data[0];
    taxPeriod = accountData.Tax_Period_CT;
    ctTrn = accountData.Corporate_Tax_TRN;
    legalNameTaxablePerson = accountData.Legal_Name_of_Taxable_Person;

    console.log("TAX PERIOD CT : ", taxPeriod);
    console.log("TAX REGISTRATION NUMBER : ", ctTrn);
    console.log("LEGAL NAME OF TAXABLE PERSON: ", legalNameTaxablePerson);

    document.getElementById("tax-period-ct").value = taxPeriod || "";
    document.getElementById("tax-registration-number").value = ctTrn || "";
    document.getElementById("name-of-taxable-person").value = legalNameTaxablePerson || "";

    ZOHO.CRM.UI.Resize({ height: "80%"}).then(function(data) {
      console.log("Resize result:", data);
    });


  } catch (err) {
    console.error(err);
  }
});

function clearErrors() {
  document.querySelectorAll(".error-message").forEach((span) => {
    span.textContent = "";
  });
}

function showError(fieldId, message) {
  const errorSpan = document.getElementById(`error-${fieldId}`);
  if (errorSpan) errorSpan.textContent = message;
}

function showUploadBuffer() {
  const buffer = document.getElementById("upload-buffer");
  const bar = document.getElementById("upload-progress");
  if (buffer) buffer.classList.remove("hidden");
  if (bar) {
    bar.classList.remove("animate");
    void bar.offsetWidth;
    bar.classList.add("animate");
  }
}

function hideUploadBuffer() {
  const buffer = document.getElementById("upload-buffer");
  if (buffer) buffer.classList.add("hidden");
}

function getCTReturnDueDate(taxPeriodCT, financialYearEnding) {
  const parts = (taxPeriodCT || "").split(" - ");
  if (parts.length !== 2) return null;

  const endMonth = parts[1].trim();
  const year = parseInt(financialYearEnding, 10);
  if (isNaN(year)) return null;

  // Get 0-based month index
  const monthIndex = new Date(`${endMonth} 1, ${year}`).getMonth();

  // Get last day of end month
  const baseDate = new Date(year, monthIndex + 1, 0);

  // Add 21 months without overflow
  const targetYear = baseDate.getFullYear() + Math.floor((baseDate.getMonth() + 21) / 12);
  const targetMonth = (baseDate.getMonth() + 21) % 12;

  // Get last day of the resulting month
  const dueDate = new Date(targetYear, targetMonth + 1, 0);

  // Format yyyy-mm-dd
  return (
    dueDate.getFullYear() + "-" +
    String(dueDate.getMonth() + 1).padStart(2, "0") + "-" +
    String(dueDate.getDate()).padStart(2, "0")
  );
}

function validateFinancialYear(fy) {
  if (!/^\d{4}$/.test(fy)) {
    return "Enter a four-digit year (e.g., 2025).";
  }
  const year = parseInt(fy, 10);
  if (year < 2025 || year > 2050) {
    return "Year must be between 2025 and 2050.";
  }
  return "";
}

const fyInput = document.getElementById("financial-year");
if (fyInput) {
  fyInput.addEventListener("input", () => {
    fyInput.value = fyInput.value.replace(/\D/g, "").slice(0, 4);
    const err = validateFinancialYear(fyInput.value);
    if (!err) {
      const span = document.getElementById("error-financial-year");
      if (span) span.textContent = "";
    }
  });
  fyInput.addEventListener("blur", () => {
    const val = fyInput.value;
    if (/^\d{4}$/.test(val)) {
      let year = parseInt(val, 10);
      if (year < 2025) year = 2025;
      if (year > 2050) year = 2050;
      fyInput.value = String(year);
    }
  });
}

async function cacheFileOnChange(event) {
  clearErrors();

  const fileInput = event.target;
  const file = fileInput?.files[0];
  if (!file) return;

  if (file.size > 20 * 1024 * 1024) {
    showError("corporate-tax-return", "File size must not exceed 20MB.");
    return;
  }

  showUploadBuffer();

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

    cachedFile = file;
    cachedBase64 = base64;

    await new Promise((res) => setTimeout(res, 3000));
    hideUploadBuffer();
  } catch (err) {
    console.error("Error caching file:", err);
    hideUploadBuffer();
    showError("corporate-tax-return", "Failed to read file.");
  }
}

async function uploadFileToCRM() {
  if (!cachedFile || !cachedBase64) {
    throw new Error("No cached file");
  }

  return await ZOHO.CRM.API.attachFile({
    Entity: "Applications1",
    RecordID: app_id,
    File: {
      Name: cachedFile.name,
      Content: cachedBase64,
    },
  });
}

async function update_record(event = null) {
  if (event) event.preventDefault();

  clearErrors();

  let hasError = false;
  const submitBtn = document.getElementById("submit_button_id");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
  }

  const referenceNo = document.getElementById("reference-number")?.value;
  const taxablePerson = document.getElementById("name-of-taxable-person")?.value;
  const taxRegNo = document.getElementById("tax-registration-number")?.value;
  const taxPeriodCt = document.getElementById("tax-period-ct")?.value;
  const financialYear = document.getElementById("financial-year")?.value;
  const taxPaid = document.getElementById("tax-paid")?.value;
  const subDate = document.getElementById("submission-date")?.value;

  if (!subDate) {
    showError("submission-date", "Submission Date is required.");
    hasError = true;
  }
  if (!referenceNo) {
    showError("reference-number", "Reference Number is required.");
    hasError = true;
  }
  if (!taxablePerson) {
    showError("name-of-taxable-person", "Legal Name of Taxable Person is required.");
    hasError = true;
  }
  if (!taxRegNo) {
    showError("tax-registration-number", "Tax Registration Number is required.");
    hasError = true;
  }
  if (!taxPeriodCt) {
    showError("tax-period-ct", "Tax Period CT is required.");
    hasError = true;
  }
  if (!financialYear) {
    showError("financial-year", "Financial Year (Ending) is required.");
    hasError = true;
  } else {
    const fyErr = validateFinancialYear(financialYear);
    if (fyErr) {
      showError("financial-year", fyErr);
      hasError = true;
    }
  }
  if (!taxPaid) {
    showError("tax-paid", "Tax Paid is required.");
    hasError = true;
  }
  if (!cachedFile || !cachedBase64) {
    showError("corporate-tax-return", "Please upload the Corporate Tax Return.");
    hasError = true;
  }

  if (hasError) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
    return;
  }

  try {
    await ZOHO.CRM.API.updateRecord({
      Entity: "Applications1",
      APIData: {
        id: app_id,
        Reference_Number: referenceNo,
        Legal_Name_of_Taxable_Person: taxablePerson,
        Tax_Registration_Number_TRN: taxRegNo,
        Tax_Period_CT: taxPeriodCt,
        Financial_Year_Ending: financialYear,
        Tax_Paid: taxPaid,
        Application_Date: subDate,
        Application_Issuance_Date: subDate,
      },
    });

    const ctReturnDd = getCTReturnDueDate(taxPeriodCt, financialYear);
    console.log("Computed CT_Return_DD:", ctReturnDd);

    await ZOHO.CRM.API.updateRecord({
      Entity: "Accounts",
      APIData: {
        id: account_id,
        CT_Status: "Active",
        Tax_Period_CT: taxPeriodCt,
        Corporate_Tax_TRN: taxRegNo,
        CT_Return_DD: ctReturnDd,
        Legal_Name_of_Taxable_Person: taxablePerson,
      },
    });

    await uploadFileToCRM();
    await ZOHO.CRM.BLUEPRINT.proceed();
    await ZOHO.CRM.UI.Popup.closeReload();
  } catch (error) {
    console.error("Error on final submit:", error);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  }
}

document.getElementById("corporate-tax-return").addEventListener("change", cacheFileOnChange);
document.getElementById("record-form").addEventListener("submit", update_record);

async function closeWidget() {
  await ZOHO.CRM.UI.Popup.closeReload().then(console.log);
}

ZOHO.embeddedApp.init();
