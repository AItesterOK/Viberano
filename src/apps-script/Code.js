function doGet() {
  try {
    assertAuthorized_();
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle(APP.NAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    return HtmlService.createHtmlOutput('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial,sans-serif;padding:48px;color:#3b4443}main{max-width:620px;margin:auto}h1{color:#0062ff}</style></head><body><main><h1>Acceso no disponible</h1><p>' + String(error.message || error).replace(/[<>&]/g, '') + '</p></main></body></html>');
  }
}
