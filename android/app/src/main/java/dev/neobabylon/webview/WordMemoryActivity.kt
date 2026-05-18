package dev.neobabylon.webview

import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import dev.neobabylon.webview.databinding.ItemMemoryCardBinding
import dev.neobabylon.webview.databinding.ItemMemoryEntryBinding

class WordMemoryActivity : AppCompatActivity() {

    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var list: RecyclerView
    private lateinit var empty: TextView
    private val adapter = MemoryAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_word_memory)

        prefs = getSharedPreferences(NeoBridge.PREFS_NAME, MODE_PRIVATE)

        val toolbar = findViewById<MaterialToolbar>(R.id.memoryToolbar)
        setSupportActionBar(toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        toolbar.setNavigationOnClickListener { finish() }

        list = findViewById(R.id.memoryList)
        empty = findViewById(R.id.memoryEmpty)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter

        refresh()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_word_memory, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_clear_memory) {
            AlertDialog.Builder(this)
                .setTitle(R.string.word_memory_clear_title)
                .setMessage(R.string.word_memory_clear_message)
                .setPositiveButton(R.string.word_memory_clear_confirm) { _, _ ->
                    LookupMemory.clear(prefs)
                    refresh()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun refresh() {
        val view = LookupMemory.buildView(prefs)
        adapter.submit(view)
        val hasData = view.timeline.isNotEmpty()
        empty.visibility = if (hasData) View.GONE else View.VISIBLE
        list.visibility = if (hasData) View.VISIBLE else View.GONE
    }

    private sealed class Row {
        data class Section(val title: String) : Row()

        data class Repeated(val group: LookupMemory.RepeatedGroup) : Row()

        data class Timeline(val entry: LookupMemory.Entry) : Row()
    }

    private class MemoryAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        private var rows: List<Row> = emptyList()

        fun submit(view: LookupMemory.ViewModel) {
            val out = mutableListOf<Row>()
            if (view.repeated.isNotEmpty()) {
                out.add(Row.Section("Looked up again"))
                for (g in view.repeated) {
                    out.add(Row.Repeated(g))
                }
            }
            if (view.timeline.isNotEmpty()) {
                out.add(Row.Section("All lookups (newest first)"))
                for (e in view.timeline) {
                    out.add(Row.Timeline(e))
                }
            }
            rows = out
            notifyDataSetChanged()
        }

        override fun getItemViewType(position: Int): Int =
            when (rows[position]) {
                is Row.Section -> 0
                is Row.Repeated -> 1
                is Row.Timeline -> 2
            }

        override fun onCreateViewHolder(
            parent: ViewGroup,
            viewType: Int,
        ): RecyclerView.ViewHolder {
            val inf = LayoutInflater.from(parent.context)
            return when (viewType) {
                0 -> {
                    val v = inf.inflate(R.layout.item_memory_section, parent, false)
                    SectionHolder(v as TextView)
                }
                1 -> {
                    CardHolder(ItemMemoryCardBinding.inflate(inf, parent, false))
                }
                else -> {
                    CardHolder(ItemMemoryCardBinding.inflate(inf, parent, false))
                }
            }
        }

        override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
            when (val row = rows[position]) {
                is Row.Section -> (holder as SectionHolder).title.text = row.title
                is Row.Repeated -> (holder as CardHolder).bindRepeated(row.group)
                is Row.Timeline -> (holder as CardHolder).bindTimeline(row.entry)
            }
        }

        override fun getItemCount(): Int = rows.size

        private class SectionHolder(val title: TextView) : RecyclerView.ViewHolder(title)

        private class CardHolder(
            private val binding: ItemMemoryCardBinding,
        ) : RecyclerView.ViewHolder(binding.root) {
            fun bindRepeated(group: LookupMemory.RepeatedGroup) {
                binding.memoryWord.text = group.word
                binding.memoryMeta.visibility = View.VISIBLE
                binding.memoryMeta.text =
                    binding.root.context.getString(
                        R.string.word_memory_lookup_count,
                        group.count,
                    )
                binding.memoryEntriesContainer.visibility = View.VISIBLE
                fillEntries(binding.memoryEntriesContainer, group.entries, showDividers = true)
            }

            fun bindTimeline(entry: LookupMemory.Entry) {
                binding.memoryWord.text = entry.word
                binding.memoryMeta.visibility = View.VISIBLE
                binding.memoryMeta.text = LookupMemory.formatWhen(entry.ts)
                binding.memoryEntriesContainer.visibility = View.VISIBLE
                fillEntries(binding.memoryEntriesContainer, listOf(entry), showDividers = false)
            }

            private fun fillEntries(
                container: LinearLayout,
                entries: List<LookupMemory.Entry>,
                showDividers: Boolean,
            ) {
                container.removeAllViews()
                val ctx = container.context
                val inf = LayoutInflater.from(ctx)
                entries.forEachIndexed { index, entry ->
                    val eb = ItemMemoryEntryBinding.inflate(inf, container, true)
                    eb.memoryEntryDivider.visibility =
                        if (showDividers && index > 0) View.VISIBLE else View.GONE
                    if (!showDividers) {
                        eb.memoryEntryWhen.visibility = View.GONE
                    } else {
                        eb.memoryEntryWhen.visibility = View.VISIBLE
                        eb.memoryEntryWhen.text = LookupMemory.formatWhen(entry.ts)
                    }
                    eb.memoryEntryTranslation.text = entry.translation
                    val def = entry.definition
                    if (!def.isNullOrBlank()) {
                        eb.memoryEntryDefinition.visibility = View.VISIBLE
                        eb.memoryEntryDefinition.text = def
                    } else {
                        eb.memoryEntryDefinition.visibility = View.GONE
                    }
                }
            }
        }
    }
}
