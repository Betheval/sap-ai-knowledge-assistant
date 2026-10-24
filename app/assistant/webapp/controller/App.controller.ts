import type ResourceBundle from 'sap/base/i18n/ResourceBundle'
import type Button from 'sap/m/Button'
import type { FeedInput$PostEvent } from 'sap/m/FeedInput'
import type Link from 'sap/m/Link'
import type List from 'sap/m/List'
import type { ListBase$SelectionChangeEvent } from 'sap/m/ListBase'
import type ScrollContainer from 'sap/m/ScrollContainer'
import type SplitApp from 'sap/m/SplitApp'
import type Event from 'sap/ui/base/Event'
import Device from 'sap/ui/Device'
import Messaging from 'sap/ui/core/Messaging'
import Controller from 'sap/ui/core/mvc/Controller'
import JSONModel from 'sap/ui/model/json/JSONModel'
import type Context from 'sap/ui/model/odata/v4/Context'
import type ODataContextBinding from 'sap/ui/model/odata/v4/ODataContextBinding'
import type ODataModel from 'sap/ui/model/odata/v4/ODataModel'
import type ResourceModel from 'sap/ui/model/resource/ResourceModel'
import Sorter from 'sap/ui/model/Sorter'
import { describeAskError } from '../util/errors'
import { renderMarkdown, type CitationTarget } from '../util/markdown'

interface Source {
  title: string
  url: string
  cited: boolean
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text?: string
  html?: string
  sources?: Source[]
  pending?: boolean
  error?: { text: string; retryable: boolean }
  /** Question an assistant message answers; used to retry after an error. */
  question?: string
}

interface ChatState {
  conversationId: string | null
  messages: ChatMessage[]
  busy: boolean
  elapsed: number
  llmDown: boolean
}

interface AskResult {
  conversationId: string
  answer: string
  sources: { title: string; url: string; cited: boolean }[]
}

interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: { rank: number; title: string; url: string; cited: boolean }[]
}

/**
 * Chat with the knowledge assistant (ADR 0015).
 * @namespace knowledge.assistant.controller
 */
export default class App extends Controller {
  private chat!: JSONModel
  private timer?: ReturnType<typeof setInterval>
  private bundle?: ResourceBundle

  public onInit(): void {
    const state: ChatState = { conversationId: null, messages: [], busy: false, elapsed: 0, llmDown: false }
    this.chat = new JSONModel(state)
    this.getView()!.setModel(this.chat, 'chat')
    void this.checkLlmHealth()
    // The i18n model loads asynchronously; texts built in code use the bundle once it is there
    const i18n = this.getOwnerComponent()!.getModel('i18n') as ResourceModel
    void (i18n.getResourceBundle() as Promise<ResourceBundle>).then((bundle) => (this.bundle = bundle))
  }

  public onExit(): void {
    this.stopTimer()
  }

  // ---------------------------------------------------------------- events

  public onPost(event: FeedInput$PostEvent): void {
    const question = (event.getParameter('value') ?? '').trim()
    if (question) void this.ask(question)
  }

  public onExample(event: Event): void {
    void this.ask((event.getSource() as Link).getText())
  }

  public onRetry(event: Event): void {
    const context = (event.getSource() as Button).getBindingContext('chat')!
    const message = context.getObject() as ChatMessage
    const index = Number(context.getPath().split('/').pop())
    void this.send(message.question!, index)
  }

  public onNewConversation(): void {
    this.control<List>('conversationList').removeSelections(true)
    this.chat.setProperty('/conversationId', null)
    this.chat.setProperty('/messages', [])
    this.showChat()
  }

  public async onConversationSelect(event: ListBase$SelectionChangeEvent): Promise<void> {
    const context = event.getParameter('listItem')?.getBindingContext() as Context | undefined
    if (!context) return
    const conversationId = context.getProperty('ID') as string
    this.chat.setProperty('/conversationId', conversationId)
    this.chat.setProperty('/messages', [])
    this.showChat()

    const binding = this.odata().bindList(
      `/Conversations(${conversationId})/messages`,
      undefined,
      [new Sorter('sequence')],
      undefined,
      { $select: 'role,content', $expand: 'sources($select=rank,title,url,cited;$orderby=rank)' },
    )
    const contexts = await binding.requestContexts(0, 500)
    this.chat.setProperty(
      '/messages',
      contexts.map((c) => this.toChatMessage(c.getObject() as StoredMessage)),
    )
    this.scrollToEnd()
  }

  /** On phones the chat is a separate page; elsewhere it is always visible. */
  private showChat(): void {
    const splitApp = this.control<SplitApp>('splitApp')
    const chat = this.createId('chat')!
    if (splitApp.getCurrentDetailPage()?.getId() !== chat || !splitApp.isMasterShown()) {
      if (Device.system.phone) splitApp.toDetail(chat, 'slide')
    }
  }

  public onNavBack(): void {
    this.control<SplitApp>('splitApp').toMaster(this.createId('master')!, 'slide')
  }

  public formatThinking(elapsed: number): string {
    return this.text('thinking', [String(elapsed)])
  }

  // ---------------------------------------------------------------- asking

  private async ask(question: string): Promise<void> {
    if (this.chat.getProperty('/busy')) return
    const messages = this.messages()
    messages.push({ role: 'user', text: question })
    messages.push({ role: 'assistant', question, pending: true })
    this.chat.setProperty('/messages', messages)
    await this.send(question, messages.length - 1)
  }

  /** Sends the question and fills the assistant message at `index` with the answer or the error. */
  private async send(question: string, index: number): Promise<void> {
    this.chat.setProperty(`/messages/${index}`, { role: 'assistant', question, pending: true })
    this.chat.setProperty('/busy', true)
    this.startTimer()
    this.scrollToEnd()

    const conversationId = this.chat.getProperty('/conversationId') as string | null
    const action = this.odata().bindContext('/ask(...)') as ODataContextBinding
    action.setParameter('question', question)
    if (conversationId) action.setParameter('conversationId', conversationId)

    try {
      await action.invoke()
      const result = action.getBoundContext().getObject() as AskResult
      this.chat.setProperty(`/messages/${index}`, this.toAnswer(result.answer, result.sources))
      if (!conversationId) {
        this.chat.setProperty('/conversationId', result.conversationId)
        this.control<List>('conversationList').getBinding('items')?.refresh()
      }
    } catch (error) {
      // The OData model also reports the failure as a message; the chat shows it instead
      Messaging.removeAllMessages()
      const info = describeAskError(error)
      const text = this.text(info.key, info.detail ? [info.detail] : undefined)
      this.chat.setProperty(`/messages/${index}`, {
        role: 'assistant',
        question,
        error: { text, retryable: info.retryable },
      })
    } finally {
      this.stopTimer()
      this.chat.setProperty('/busy', false)
      this.scrollToEnd()
    }
  }

  // --------------------------------------------------------------- helpers

  private toChatMessage(stored: StoredMessage): ChatMessage {
    if (stored.role === 'user') return { role: 'user', text: stored.content }
    return this.toAnswer(stored.content, stored.sources ?? [])
  }

  /** Sources keep their citation order for the [n] links; the list shows cited ones first. */
  private toAnswer(answer: string, sources: Source[]): ChatMessage {
    const targets: CitationTarget[] = sources.map((s) => ({ url: s.url, title: s.title }))
    const listed = [...sources].sort((a, b) => Number(b.cited) - Number(a.cited))
    return { role: 'assistant', html: renderMarkdown(answer, targets), sources: listed }
  }

  private async checkLlmHealth(): Promise<void> {
    try {
      const response = await fetch('/health/llm')
      this.chat.setProperty('/llmDown', !response.ok)
    } catch {
      this.chat.setProperty('/llmDown', true)
    }
  }

  private startTimer(): void {
    this.stopTimer()
    this.chat.setProperty('/elapsed', 0)
    this.timer = setInterval(
      () => this.chat.setProperty('/elapsed', this.chat.getProperty('/elapsed') + 1),
      1000,
    )
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      const scroller = this.control<ScrollContainer>('messageScroller')
      const height = scroller.getDomRef()?.scrollHeight ?? 0
      scroller.scrollTo(0, height, 300)
    }, 0)
  }

  private messages(): ChatMessage[] {
    return [...(this.chat.getProperty('/messages') as ChatMessage[])]
  }

  private odata(): ODataModel {
    return this.getOwnerComponent()!.getModel() as ODataModel
  }

  private text(key: string, args?: string[]): string {
    return this.bundle?.getText(key, args) ?? key
  }

  private control<T>(id: string): T {
    return this.byId(id) as T
  }
}
