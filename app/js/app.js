let app_id, account_id;
let cachedFile = null;
let cachedBase64 = null;
let cachedFilePayment = null;
let cachedBase64Payment = null;

function showModal(type, title, message) {
  const modal = document.getElementById("custom-modal");
  const iconSuccess = document.getElementById("modal-icon-success");
  const iconError = document.getElementById("modal-icon-error");
  const iconLoading = document.getElementById("modal-icon-loading");
  const modalBtn = document.getElementById("modal-close");
  
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-message").textContent = message;

  [iconSuccess, iconError, iconLoading].forEach(el => el.classList.add("hidden"));

  if (type === "loading") {
    iconLoading.classList.remove("hidden");
    modalBtn.classList.add("hidden");
  } else if (type === "success") {
    iconSuccess.classList.remove("hidden");
    modalBtn.classList.remove("hidden");
    modalBtn.textContent = "Click to reload";
    modalBtn.onclick = async () => {
      modalBtn.disabled = true;
      modalBtn.textContent = "Reloading...";
      try {
        await ZOHO.CRM.BLUEPRINT.proceed();
        setTimeout(() => { window.top.location.reload(); }, 600);
      } catch (e) {
        ZOHO.CRM.UI.Popup.closeReload();
      }
    };
  } else {
    iconError.classList.remove("hidden");
    modalBtn.classList.remove("hidden");
    modalBtn.textContent = "Try Again";
    modalBtn.onclick = () => { modal.classList.replace("flex", "hidden"); };
  }
  modal.classList.replace("hidden", "flex");
}

function clearErrors() {
  document.querySelectorAll(".error-message").forEach((span) => { span.textContent = ""; });
}

function showError(fieldId, message) {
  const errorSpan = document.getElementById(`error-${fieldId}`);
  if (errorSpan) errorSpan.textContent = message;
}

function showUploadBuffer() {
  document.getElementById("upload-buffer").classList.remove("hidden");
}

function hideUploadBuffer() {
  document.getElementById("upload-buffer").classList.add("hidden");
}

async function closeWidget() {
  await ZOHO.CRM.UI.Popup.closeReload();
}

ZOHO.embeddedApp.on("PageLoad", async (entity) => {
  try {
    const appResponse = await ZOHO.CRM.API.getRecord({ Entity: "Applications1", RecordID: entity.EntityId });
    const applicationData = appResponse.data[0];
    app_id = applicationData.id;
    account_id = applicationData.Account_Name?.id;

    const accountResponse = await ZOHO.CRM.API.getRecord({ Entity: "Accounts", RecordID: account_id });
    const accountData = accountResponse.data[0];

    document.getElementById("pay-giban").value = accountData.CT_Pay_GIBAN || "";
    document.getElementById("tax-period-ct").value = accountData.Tax_Period_CT || "";
    document.getElementById("tax-registration-number").value = accountData.Corporate_Tax_TRN || "";
    document.getElementById("name-of-taxable-person").value = accountData.Legal_Name_of_Taxable_Person || applicationData.Account_Name.name || "";

    if (accountData.CT_Return_DD) {
      document.getElementById("financial-year").value = getFinancialYear(accountData.CT_Return_DD);
    }
    ZOHO.CRM.UI.Resize({ height: "100%" });
  } catch (err) { console.error(err); }
});

function getFinancialYear(ctReturnDD) {
  if (!ctReturnDD) return null;
  const returnDate = new Date(ctReturnDD);
  let month = returnDate.getMonth() - 9;
  let year = returnDate.getFullYear();
  if (month < 0) { month += 12; year -= 1; }
  return new Date(year, month, 1).getFullYear();
}

function getCTReturnDueDate(taxPeriodCT, financialYearEnding) {
  const parts = (taxPeriodCT || "").split(" - ");
  if (parts.length !== 2) return null;
  const endMonth = parts[1].trim();
  const year = parseInt(financialYearEnding, 10);
  const monthIndex = new Date(`${endMonth} 1, ${year}`).getMonth();
  const baseDate = new Date(year, monthIndex + 1, 0);
  const targetYear = baseDate.getFullYear() + Math.floor((baseDate.getMonth() + 21) / 12);
  const targetMonth = (baseDate.getMonth() + 21) % 12;
  const dueDate = new Date(targetYear, targetMonth + 1, 0);
  return dueDate.getFullYear() + "-" + String(dueDate.getMonth() + 1).padStart(2, "0") + "-" + String(dueDate.getDate()).padStart(2, "0");
}

/**
 * FIXED: Handles both files using binary ArrayBuffer to prevent corruption
 */
async function handleFileSelection(file, inputId) {
  if (!file) return;
  const zone = document.querySelector(`.drop-zone[data-input-id="${inputId}"]`);
  showUploadBuffer();
  try {
    const content = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result); 
      reader.onerror = rej;
      reader.readAsArrayBuffer(file); // Binary fix
    });
    
    if (inputId === "corporate-tax-return") {
      cachedFile = file; 
      cachedBase64 = content;
      document.getElementById("return-text").innerHTML = `<strong>✓ ${file.name}</strong>`;
    } else if (inputId === "payment-instruction") {
      cachedFilePayment = file; 
      cachedBase64Payment = content;
      document.getElementById("payment-text").innerHTML = `<strong>✓ ${file.name}</strong>`;
    }

    if(zone) zone.classList.add('file-set');
    setTimeout(hideUploadBuffer, 800);
  } catch (err) { 
    hideUploadBuffer(); 
    showError(inputId, "Failed to read file."); 
  }
}

/**
 * FIXED: Uploads both files individually to Zoho
 */
async function uploadFileToCRM() {
  if (cachedFile && cachedBase64) {
    await ZOHO.CRM.API.attachFile({ 
      Entity: "Applications1", 
      RecordID: app_id, 
      File: { Name: cachedFile.name, Content: cachedBase64 } 
    });
  }
  if (cachedFilePayment && cachedBase64Payment) {
    await ZOHO.CRM.API.attachFile({ 
      Entity: "Applications1", 
      RecordID: app_id, 
      File: { Name: cachedFilePayment.name, Content: cachedBase64Payment } 
    });
  }
}

async function update_record(event) {
  event.preventDefault();
  clearErrors();
  let hasError = false;

  const data = {
    referenceNo: document.getElementById("reference-number").value.trim(),
    taxablePerson: document.getElementById("name-of-taxable-person").value.trim(),
    taxRegNo: document.getElementById("tax-registration-number").value.trim(),
    taxPeriodCt: document.getElementById("tax-period-ct").value,
    financialYear: document.getElementById("financial-year").value,
    taxPaid: document.getElementById("tax-paid").value,
    subDate: document.getElementById("submission-date").value,
    paymentRef: document.getElementById("payment-reference").value.trim(),
    payGiban: document.getElementById("pay-giban").value.trim()
  };

  if (!data.subDate) { showError("submission-date", "Required."); hasError = true; }
  if (!data.referenceNo) { showError("reference-number", "Required."); hasError = true; }
  if (!data.taxablePerson) { showError("name-of-taxable-person", "Required."); hasError = true; }
  if (!data.taxRegNo) { showError("tax-registration-number", "Required."); hasError = true; }
  if (!data.taxPeriodCt) { showError("tax-period-ct", "Required."); hasError = true; }
  if (!data.financialYear) { showError("financial-year", "Required."); hasError = true; }
  if (!data.taxPaid) { showError("tax-paid", "Required."); hasError = true; }
  if (!cachedFile) { showError("corporate-tax-return", "File required."); hasError = true; }

  if (parseFloat(data.taxPaid) > 0) {
    if (!data.paymentRef) { showError("payment-reference", "Required."); hasError = true; }
    if (!data.payGiban) { showError("pay-giban", "Required."); hasError = true; }
    if (!cachedFilePayment) { showError("payment-instruction", "File required."); hasError = true; }
  }

  if (hasError) return;

  showModal("loading", "Uploading...", "Please wait while we process your submission and upload files.");

  try {
    const ctReturnDd = getCTReturnDueDate(data.taxPeriodCt, data.financialYear);
    await ZOHO.CRM.API.updateRecord({
      Entity: "Applications1",
      APIData: {
        id: app_id, Reference_Number: data.referenceNo, Legal_Name_of_Taxable_Person: data.taxablePerson,
        Tax_Registration_Number_TRN: data.taxRegNo, Tax_Period_CT: data.taxPeriodCt, Financial_Year_Ending: data.financialYear,
        Tax_Paid: data.taxPaid, Application_Date: data.subDate, Application_Issuance_Date: data.subDate,
        Payment_Reference: data.paymentRef, Pay_GIBAN: data.payGiban
      }
    });

    const req_data = {
      "arguments": JSON.stringify({
        "account_id": account_id, "tax_period_ct": data.taxPeriodCt, "corporate_tax_trn": data.taxRegNo,
        "ct_return_dd": ctReturnDd, "pay_giban": data.payGiban, "legal_taxable_person": data.taxablePerson
      })
    };

    await ZOHO.CRM.FUNCTIONS.execute("ta_ctar_complete_the_process_update_account", req_data);
    await uploadFileToCRM(); // Uploads both cached files
    showModal("success", "Submission Successful", "The record has been updated successfully.");
  } catch (error) {
    showModal("error", "Submission Failed", "There was an error updating the record.");
  }
}

function initializeDragAndDrop() {
  document.querySelectorAll('.drop-zone').forEach(zone => {
    const inputId = zone.getAttribute('data-input-id');
    const input = document.getElementById(inputId);
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('bg-blue-50'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('bg-blue-50'); });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('bg-blue-50');
      handleFileSelection(e.dataTransfer.files[0], inputId);
    });
    input.addEventListener('change', (e) => handleFileSelection(e.target.files[0], inputId));
  });
}

function initializeListeners() {
  document.getElementById("record-form").addEventListener("submit", update_record);
  document.getElementById("tax-paid").addEventListener("input", (e) => {
    document.getElementById("payment-fields").style.display = (parseFloat(e.target.value) || 0) > 0 ? "block" : "none";
  });
  initializeDragAndDrop();
  ZOHO.embeddedApp.init();
}
initializeListeners();