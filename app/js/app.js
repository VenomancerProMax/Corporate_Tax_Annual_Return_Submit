let app_id, account_id;
let cachedFile = null;
let cachedBase64 = null;

// NEW: separate cache for payment-instruction
let cachedFilePayment = null;
let cachedBase64Payment = null;

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
    legalNameTaxablePerson = accountData.Account_Name;
    accountCTReturnDD = accountData.CT_Return_DD;

    console.log("TAX PERIOD CT : ", taxPeriod);
    console.log("TAX REGISTRATION NUMBER : ", ctTrn);
    console.log("LEGAL NAME OF TAXABLE PERSON: ", legalNameTaxablePerson);

    document.getElementById("tax-period-ct").value = taxPeriod || "";
    document.getElementById("tax-registration-number").value = ctTrn || "";
    document.getElementById("name-of-taxable-person").value = legalNameTaxablePerson || "";
    
    // Auto-populate the financial year
    if (accountCTReturnDD) {
        document.getElementById("financial-year").value = getFinancialYear(accountCTReturnDD);
    }

    ZOHO.CRM.UI.Resize({ height: "100%"}).then(function(data) {
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
  if (year > 2050) {
    return "Year must be between 2025 and 2050.";
  }
  return "";
}

// Corrected function to calculate financial year by subtracting 9 months
function getFinancialYear(ctReturnDD) {
    if (!ctReturnDD) return null;

    // Convert string to Date object
    const returnDate = new Date(ctReturnDD);

    // Get the month (0-11)
    let month = returnDate.getMonth();
    // Get the year
    let year = returnDate.getFullYear();

    // Subtract 9 months
    month -= 9;

    // Adjust year if month becomes negative
    if (month < 0) {
        month += 12;
        year -= 1;
    }

    // Create a new date and return the year
    return new Date(year, month, 1).getFullYear();
}

async function cacheFileOnChange(event) {
  clearErrors();
  const fileInput = event.target;
  const file = fileInput?.files[0];
  if (!file) return;

  if (file.size > 20 * 1024 * 1024) {
    showError(fileInput.id, "File size must not exceed 20MB.");
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

    // cache depending on which input triggered
    if (fileInput.id === "corporate-tax-return") {
      cachedFile = file;
      cachedBase64 = base64;
    } else if (fileInput.id === "payment-instruction") {
      cachedFilePayment = file;
      cachedBase64Payment = base64;
    }

    await new Promise((res) => setTimeout(res, 3000));
    hideUploadBuffer();
  } catch (err) {
    console.error("Error caching file:", err);
    hideUploadBuffer();
    showError(event.target.id, "Failed to read file.");
  }
}

async function uploadFileToCRM() {
  // attach corporate-tax-return
  if (cachedFile && cachedBase64) {
    await ZOHO.CRM.API.attachFile({
      Entity: "Applications1",
      RecordID: app_id,
      File: { Name: cachedFile.name, Content: cachedBase64 },
    });
  }
  // NEW: attach payment-instruction if present
  if (cachedFilePayment && cachedBase64Payment) {
    await ZOHO.CRM.API.attachFile({
      Entity: "Applications1",
      RecordID: app_id,
      File: { Name: cachedFilePayment.name, Content: cachedBase64Payment },
    });
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const paymentReference = document.getElementById("payment-reference");
  const paymentInstruction = document.getElementById("payment-instruction");
  const taxPaid = document.getElementById("tax-paid");

  const paymentFieldsDiv = document.getElementById("payment-fields");
  const paymentRefLabel = document.getElementById("payment-ref-label");
  const paymentInstLabel = document.getElementById("payment-inst-label");

  function checkTax() {
    const value = parseFloat(taxPaid.value) || 0;
    const isRequired = value > 0;

    // Toggle visibility of the payment fields container
    if (paymentFieldsDiv) {
      paymentFieldsDiv.style.display = isRequired ? "block" : "none";
    }

    // Set or remove 'required' attributes and the red asterisk
    if (isRequired) {
      paymentReference.setAttribute("required", "required");
      paymentInstruction.setAttribute("required", "required");

      if (!paymentRefLabel.querySelector(".required-star")) {
        paymentRefLabel.innerHTML =
          'Payment Reference <span class="required-star" style="color:red">*</span>';
      }

      // FIX: Correctly add the required-star for Payment Instruction.
      const originalText = 'Payment Instruction';
      const requiredStar = ' <span class="required-star" style="color:red">*</span>';
      const infoIcon = ' <span title="Drag and drop your file here, or click “Choose File” to upload the Payment Instruction." style="cursor: help; color: #555;">&#9432;</span>';
      paymentInstLabel.innerHTML = originalText + infoIcon + requiredStar;

    } else {
      paymentReference.removeAttribute("required");
      paymentInstruction.removeAttribute("required");

      paymentRefLabel.textContent = "Payment Reference";
      
      // FIX: Correctly reset the Payment Instruction label text
      const instructionLabelText = "Payment Instruction";
      const infoIcon = ' <span title="Drag and drop your file here, or click “Choose File” to upload the Payment Instruction." style="cursor: help; color: #555;">&#9432;</span>';
      paymentInstLabel.innerHTML = instructionLabelText + infoIcon;
    }
  }

  // Set the initial state on page load based on the fetched value
  // and attach the event listener for real-time updates
  checkTax();
  taxPaid.addEventListener("input", checkTax);
});

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
  const paymentRef = document.getElementById("payment-reference")?.value;
 
  if(!paymentRef && taxPaid > 0) {
    showError("payment-reference", "Payment Reference is required");
  }

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

  // NEW: check payment-instruction required?
  if (taxPaid > 0 && (!cachedFilePayment || !cachedBase64Payment)) {
    showError("payment-instruction", "Please upload the Payment Instruction.");
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
        Payment_Reference: paymentRef,
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
document.getElementById("payment-instruction").addEventListener("change", cacheFileOnChange);
document.getElementById("record-form").addEventListener("submit", update_record);

async function closeWidget() {
  await ZOHO.CRM.UI.Popup.closeReload().then(console.log);
}

ZOHO.embeddedApp.init();