import Device from 'sap/ui/Device'
import UIComponent from 'sap/ui/core/UIComponent'
import JSONModel from 'sap/ui/model/json/JSONModel'

/**
 * @namespace knowledge.assistant
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: 'json',
    interfaces: ['sap.ui.core.IAsyncContentCreation'],
  }

  public init(): void {
    super.init()
    const device = new JSONModel(Device)
    device.setDefaultBindingMode('OneWay')
    this.setModel(device, 'device')
  }
}
