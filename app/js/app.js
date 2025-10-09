let app_id, account_id;
let cachedFile = null;
let cachedBase64 = null;
let cachedFilePayment = null;
let cachedBase64Payment = null;

// --- Core Functions for UI/Error Management ---

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

async function closeWidget() {
  await ZOHO.CRM.UI.Popup.closeReload().then(console.log);
}

// --- Data Fetching and Auto-Population Logic ---

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

    const taxPeriod = accountData.Tax_Period_CT;
    const ctTrn = accountData.Corporate_Tax_TRN;
    const legalNameTaxablePerson = accountData.Legal_Name_of_Taxable_Person || applicationData.Account_Name.name || "";
    const accountCTReturnDD = accountData.CT_Return_DD;

    document.getElementById("tax-period-ct").value = taxPeriod || "";
    document.getElementById("tax-registration-number").value = ctTrn || "";
    document.getElementById("name-of-taxable-person").value = legalNameTaxablePerson || "";

    if (accountCTReturnDD) {
      document.getElementById("financial-year").value = getFinancialYear(accountCTReturnDD);
    }

    ZOHO.CRM.UI.Resize({ height: "100%" }).then(function (data) {
      console.log("Resize result:", data);
    });
  } catch (err) {
    console.error("Error during PageLoad data fetch:", err);
  }
});

// --- Date & File Handling Functions ---

function getCTReturnDueDate(taxPeriodCT, financialYearEnding) {
  const parts = (taxPeriodCT || "").split(" - ");
  if (parts.length !== 2) return null;

  const endMonth = parts[1].trim();
  const year = parseInt(financialYearEnding, 10);
  if (isNaN(year)) return null;

  const monthIndex = new Date(`${endMonth} 1, ${year}`).getMonth();
  const baseDate = new Date(year, monthIndex + 1, 0);

  const targetYear = baseDate.getFullYear() + Math.floor((baseDate.getMonth() + 21) / 12);
  const targetMonth = (baseDate.getMonth() + 21) % 12;

  const dueDate = new Date(targetYear, targetMonth + 1, 0);

  return (
    dueDate.getFullYear() + "-" +
    String(dueDate.getMonth() + 1).padStart(2, "0") + "-" +
    String(dueDate.getDate()).padStart(2, "0")
  );
}

function getFinancialYear(ctReturnDD) {
  if (!ctReturnDD) return null;
  const returnDate = new Date(ctReturnDD);
  let month = returnDate.getMonth();
  let year = returnDate.getFullYear();
  month -= 9;
  if (month < 0) {
    month += 12;
    year -= 1;
  }
  return new Date(year, month, 1).getFullYear();
}

function validateFinancialYear(fy) {
  if (!/^\d{4}$/.test(fy)) {
    return "Enter a four-digit year (e.g., 2025).";
  }
  const year = parseInt(fy, 10);
  if (year > 2050) {
    return "Year must be between 2025 and 2050.";
  }
  return "";
}

async function cacheFileOnChange(event) {
  clearErrors();
  const fileInput = event.target;
  const file = fileInput?.files[0];
  if (!file) {
    if (fileInput.id === "corporate-tax-return") {
      cachedFile = null;
      cachedBase64 = null;
    }
    if (fileInput.id === "payment-instruction") {
      cachedFilePayment = null;
      cachedBase64Payment = null;
    }
    return;
  }

  showUploadBuffer();

  const maxSize = 10 * 1024 * 1024; // 10 MB
  if (file.size > maxSize) {
    showError(fileInput.id, "File size must not exceed 10MB. 🙅‍♂️");
    fileInput.value = "";
    hideUploadBuffer();
    return;
  }

  try {
    const base64DataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const base64Content = base64DataUrl.split(',')[1];

    if (fileInput.id === "corporate-tax-return") {
      cachedFile = file;
      cachedBase64 = base64Content;
    } else if (fileInput.id === "payment-instruction") {
      cachedFilePayment = file;
      cachedBase64Payment = base64Content;
    }

    await new Promise((res) => setTimeout(res, 1000));
    hideUploadBuffer();
  } catch (err) {
    console.error("Error caching file:", err);
    hideUploadBuffer();
    showError(fileInput.id, "Failed to read file.");
  }
}

async function uploadFileToCRM() {
  if (cachedFile && cachedBase64) {
    await ZOHO.CRM.API.attachFile({
      Entity: "Applications1",
      RecordID: app_id,
      File: {
        Name: cachedFile.name,
        Content: cachedBase64
      },
    });
  }
  if (cachedFilePayment && cachedBase64Payment) {
    await ZOHO.CRM.API.attachFile({
      Entity: "Applications1",
      RecordID: app_id,
      File: {
        Name: cachedFilePayment.name,
        Content: cachedBase64Payment
      },
    });
  }
}

// --- Main Submission Logic ---

async function update_record(event) {
  event.preventDefault();

  clearErrors();
  let hasError = false;

  const submitBtn = document.getElementById("submit_button_id");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
  }

  const referenceNo = document.getElementById("reference-number")?.value.trim();
  const taxablePerson = document.getElementById("name-of-taxable-person")?.value.trim();
  const taxRegNo = document.getElementById("tax-registration-number")?.value.trim();
  const taxPeriodCt = document.getElementById("tax-period-ct")?.value.trim();
  const financialYear = document.getElementById("financial-year")?.value.trim();
  const taxPaid = document.getElementById("tax-paid")?.value.trim();
  const subDate = document.getElementById("submission-date")?.value.trim();
  const paymentRef = document.getElementById("payment-reference")?.value.trim();
  const payGiban = document.getElementById("pay-giban")?.value.trim();

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

  const fyErr = validateFinancialYear(financialYear);
  if (!financialYear) {
    showError("financial-year", "Financial Year (Ending) is required.");
    hasError = true;
  } else if (fyErr) {
    showError("financial-year", fyErr);
    hasError = true;
  }

  if (!taxPaid) {
    showError("tax-paid", "Tax Paid is required.");
    hasError = true;
  }
  if (!cachedFile || !cachedBase64) {
    showError("corporate-tax-return", "Please upload the Corporate Tax Return.");
    hasError = true;
  }

  if (parseFloat(taxPaid) > 0) {
    if (!paymentRef) {
      showError("payment-reference", "Payment Reference is required.");
      hasError = true;
    }

    if (!payGiban) {
      showError("pay-giban", "Pay (GIBAN) is required.");
      hasError = true;
    }

    if (!cachedFilePayment || !cachedBase64Payment) {
      showError("payment-instruction", "Please upload the Payment Instruction.");
      hasError = true;
    }


  }

  if (hasError) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
    return;
  }

  try {
    const ctReturnDd = getCTReturnDueDate(taxPeriodCt, financialYear);

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
        Payment_Reference: paymentRef,
        Pay_GIBAN: payGiban
      },
    });

    await ZOHO.CRM.API.updateRecord({
      Entity: "Accounts",
      APIData: {
        id: account_id,
        CT_Status: "Active",
        Tax_Period_CT: taxPeriodCt,
        Corporate_Tax_TRN: taxRegNo,
        CT_Return_DD: ctReturnDd,
        Legal_Name_of_Taxable_Person: taxablePerson,
        CT_Pay_GIBAN: payGiban
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

// --- Event Listeners and Initialization ---

function initializeListeners() {
  document.getElementById("corporate-tax-return").addEventListener("change", cacheFileOnChange);
  document.getElementById("payment-instruction").addEventListener("change", cacheFileOnChange);
  document.getElementById("record-form").addEventListener("submit", update_record);

  const taxPaidInput = document.getElementById("tax-paid");
  taxPaidInput.addEventListener("input", () => {
    const paymentFieldsDiv = document.getElementById("payment-fields");
    const paymentRefLabel = document.getElementById("payment-ref-label");
    const paymentReference = document.getElementById("payment-reference");
    const paymentInstLabel = document.getElementById("payment-inst-label");
    const paymentInstruction = document.getElementById("payment-instruction");
    const payGibanLabel = document.getElementById("pay-giban-label");
    const payGibanField = document.getElementById("pay-giban");

    const value = parseFloat(taxPaidInput.value) || 0;
    const isRequired = value > 0;

    paymentFieldsDiv.style.display = isRequired ? "block" : "none";

    if (isRequired) {
      paymentReference.setAttribute("required", "required");
      paymentInstruction.setAttribute("required", "required");
      payGibanField.setAttribute("required", "required");
      if (!paymentRefLabel.querySelector(".required-star")) {
        paymentRefLabel.innerHTML = 'Payment Reference <span class="required-star" style="color:red">*</span>';
      }
      if (!payGibanLabel.querySelector(".required-star")) {
        payGibanLabel.innerHTML = 'Pay (GIBAN) <span class="required-star" style="color:red">*</span>';
      }
      const instructionLabelText = 'Payment Instruction';
      const infoIcon = ' <span title="Drag and drop your file here, or click “Choose File” to upload the Payment Instruction." style="cursor: help; color: #555;">&#9432;</span>';
      const requiredStar = ' <span class="required-star" style="color:red">*</span>';
      paymentInstLabel.innerHTML = instructionLabelText + infoIcon + requiredStar;
    } else {
      paymentReference.removeAttribute("required");
      paymentInstruction.removeAttribute("required");
      payGibanField.removeAttribute("required");
      paymentRefLabel.textContent = "Payment Reference";
      payGibanLabel.textContent = "Pay (GIBAN)";
      const instructionLabelText = "Payment Instruction";
      const infoIcon = ' <span title="Drag and drop your file here, or click “Choose File” to upload the Payment Instruction." style="cursor: help; color: #555;">&#9432;</span>';
      paymentInstLabel.innerHTML = instructionLabelText + infoIcon;
    }
  });

  ZOHO.embeddedApp.init();
}

initializeListeners();