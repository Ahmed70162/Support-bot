// index.js
// ============================================================
// 🟢 1. DEPENDENCY IMPORTS
// ============================================================
import { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import mongoose from 'mongoose';

// ============================================================
// 🟡 2. CONFIGURATION (The Global Settings)
// ============================================================
const config = {
    TOKEN: 'MTQ5ODczNTg3MjM5MTI1NDE4MQ.Gtstsf.C1O3LFwX_c9NqUPtjVQHf6cSQuyGJImFozaWUc',// 🚨 REQUIRED: Put your bot token here!
    CLIENT_ID: '1498735872391254181', // 🚨 RECOMMENDED: Your bot's ID
    DB_URI: 'mongodb+srv://<user>:<password>@clustername.mongodb.net/autoshopDB?retryWrites=true&w=majority',
    PREFIX: '!',
    CURRENCY_NAME: '🪙 Credits',
    XP_GAIN_MULTIPLIER: 1.2,
    shopItems: [
        { id: 'tool_axe', name: 'Axe of Might', price: 50, type: 'Tool', icon: '⛏️' },
        { id: 'cos_crown', name: 'Royal Crown', price: 120, type: 'Cosmetic', icon: '👑' },
        { id: 'power_boost', name: 'Speed Boost', price: 30, type: 'Power-up', icon: '⚡' },
        { id: 'skin_gold', name: 'Gold Skin', price: 250, type: 'Cosmetic', icon: '✨' },
        { id: 'rare_potion', name: 'Health Potion', price: 15, type: 'Consumable', icon: '🧪' },
    ]
};

// ============================================================
// 🔵 3. DATABASE MODEL (The Data Structure)
// ============================================================
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    credits: { type: Number, default: 100 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    isVerified: { type: Boolean, default: false },
    rank: { type: String, default: 'Newbie' },
    transactionHistory: [{
        itemId: String,
        itemName: String,
        type: String,
        amount: Number, // Positive for buy, negative for sell
        timestamp: { type: Date, default: Date.now }
    }],
    inventory: [{
        itemId: String,
        itemName: String,
        quantity: Number,
        acquiredAt: { type: Date, default: Date.now }
    }]
});

// Pre-save hook: Runs BEFORE the user is saved to the DB.
UserSchema.pre('save', function(next) {
    const user = this;
    // Simple ranking logic based on level
    if (user.level >= 10) user.rank = 'Legend';
    else if (user.level >= 5) user.rank = 'Veteran';
    else if (user.level >= 2) user.rank = 'Enthusiast';
    else user.rank = 'Member';
    next();
});

const User = mongoose.model('User', UserSchema);

// ============================================================
// 🟣 4. MANAGERS (The Logic Engines)
// ============================================================

/** Handles currency flow and leveling. */
class EconomyManager {
    static async awardXp(userId, xpGained) {
        const user = await User.findOne({ userId });
        if (!user) return { level: 0, newXp: 0, leveledUp: false };

        const totalXp = user.xp + xpGained * config.XP_GAIN_MULTIPLIER;
        let newLevel = user.level;
        let leveledUp = false;

        // Leveling curve: Level X requires X * 100 XP
        while (totalXp >= newLevel * 100) {
            newLevel++;
            leveledUp = true;
        }
        
        user.xp = totalXp;
        user.level = newLevel;
        await user.save();
        
        return { level: newLevel, newXp: totalXp, leveledUp: leveledUp };
    }

    static async updateCredits(userId, amount) {
        const user = await User.findOne({ userId });
        if (!user) return { success: false, newBalance: 0 };

        const newBalance = Math.max(0, user.credits + amount);
        user.credits = newBalance;
        await user.save();
        
        return { success: true, newBalance };
    }
}

/** Handles item data and the buying/selling transaction logic. */
class ShopManager {
    static getItems() {
        return config.shopItems;
    }

    static async buyItem(userId, itemId) {
        const items = config.shopItems;
        const item = items.find(i => i.id === itemId);
        if (!item) throw new Error('Item not found! Please check the ID.');

        const user = await User.findOne({ userId });
        if (!user) throw new Error('User not found in DB!');

        // 1. Check Trust (Economy Check)
        if (user.credits < item.price) {
            throw new Error(`Insufficient Credits! You need ${item.price} ${config.CURRENCY_NAME}.`);
        }
        
        // 2. Execute Transaction (Debit Currency)
        await EconomyManager.updateCredits(userId, -item.price);

        // 3. Update Inventory
        const existingItem = user.inventory.find(i => i.itemId === itemId);
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            user.inventory.push({
                itemId: item.id,
                itemName: item.name,
                quantity: 1,
                acquiredAt: new Date()
            });
        }
        
        // 4. Log Transaction (Trust Feature)
        user.transactionHistory.push({
            itemId: item.id,
            itemName: item.name,
            type: 'BUY',
            amount: item.price,
            timestamp: new Date()
        });
        
        await user.save();

        // 5. Award XP (Engagement Feature)
        await EconomyManager.awardXp(userId, 10);

        return { 
            success: true, 
            item: item.name, 
            price: item.price, 
            newBalance: user.credits,
            xpGained: 10
        };
    }
}

// ============================================================
// 🔴 5. COMMANDS (The Interactions)
// ============================================================

// --- /shop Command ---
const shopCommand = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse the main auto shop and purchase items.')
        .addStringOption(option => 
            option.setName('item')
                .setDescription('The ID of the item to buy (e.g., tool_axe)')
                .setRequired(true)
        ),
    async execute(interaction, user) {
        const shopItems = ShopManager.getItems();
        
        // Display the Shop Menu
        const shopEmbed = new EmbedBuilder()
            .setColor(344700)
            .setTitle('🛒 🌟 The Auto Shop 🌟')
            .setDescription(`Welcome to the shop, **${user.username}**! You currently have **${user.credits} ${user.rank} Credits**.\n\nSelect an item to buy!`)
            .addFields(shopItems.map(item => ({
                name: `${item.icon} ${item.name}`,
                value: `${item.price} ${config.CURRENCY_NAME} | Type: *${item.type}*`,
                inline: true
            })));

        // Handle item argument
        if (interaction.options.getString('item')) {
            const itemId = interaction.options.getString('item');
            try {
                // Execute the Purchase Transaction
                const result = await ShopManager.buyItem(user.userId, itemId);

                // Reply with Success Message
                const successEmbed = new EmbedBuilder()
                    .setColor(5814783) // Green
                    .setTitle('✅ Purchase Successful!')
                    .setDescription(`🎉 You bought the **${result.item}** for **${result.price} ${config.CURRENCY_NAME}**.\n`)
                    .addFields(
                        { name: '✨ Your New Balance:', value: `${result.newBalance} ${config.CURRENCY_NAME}`, inline: true },
                        { name: '⬆️ XP Gained:', value: `${result.xpGained} XP`, inline: true }
                    )
                    .setFooter({ text: `Item acquired: ${result.item}` });
                return interaction.reply({ embeds: [successEmbed] });

            } catch (error) {
                // Reply with Error Message
                const errorEmbed = new EmbedBuilder()
                    .setColor(16753920) // Red
                    .setTitle('❌ Purchase Failed!')
                    .setDescription(`${error.message}\n\nCheck the item ID or your current credits.`)
                    .setFooter({ text: 'Keep trying!' });
                return interaction.reply({ embeds: [errorEmbed] });
            }
        }
        
        // If no item was provided, just show the main menu
        await interaction.reply({ embeds: [shopEmbed] });
    }
};


// --- /rank Command ---
const rankCommand = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Check your current rank and level.'),
    async execute(interaction, user) {
        const embed = new EmbedBuilder()
            .setColor('#3b82f6') // Blue
            .setTitle(`⭐ ${user.username}'s Rank Profile ⭐`)
            .setDescription(`You are currently a **${user.rank}**!`)
            .addFields(
                { name: '📈 Current Level', value: `Level **${user.level}**`, inline: true },
                { name: '💰 Current Credits', value: `${user.credits} ${config.CURRENCY_NAME}`, inline: true },
                { name: '🌟 Total XP', value: `${user.xp.toLocaleString()} XP`, inline: false }
            )
            .setFooter({ text: `Keep grinding to reach the ${user.rank === 'Legend' ? 'Mythical' : 'next'} tier!` });
        
        await interaction.reply({ embeds: [embed] });
    }
};


// --- /history Command ---
const historyCommand = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('View your recent transaction history.'),
    async execute(interaction, user) {
        // Limit history to the last 10 transactions for clean display
        const history = user.transactionHistory.sort({ timestamp: -1 }).slice(0, 10);

        const historyFields = history.map(t => {
            const color = t.type === 'BUY' ? '🟢' : '🔴';
            const typeColor = t.type === 'BUY' ? '#10B981' : '#EF4444';
            return `${color} **[${t.type}]** ${t.itemName} (${t.itemId}) - ${t.amount} ${config.CURRENCY_NAME} (${t.timestamp.toLocaleDateString()})`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor('#3b82f6')
            .setTitle(`📜 ${user.username}'s Transaction History`)
            .setDescription(history)
            .setFooter({ text: `Total Transactions: ${user.transactionHistory.length}` });

        await interaction.reply({ embeds: [embed] });
    }
};


// --- /leaderboard Command ---
const leaderboardCommand = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the top users based on XP earned.'),
    async execute(interaction, user) {
        // Find top 10 users and sort by XP descending
        const topUsers = await User.find({})
            .sort({ xp: -1 }) // Sort by XP (highest first)
            .limit(10);

        // Build the Leaderboard embed fields
        const fields = topUsers.map((u, index) => 
            `**#${index + 1}** - ${u.username} (${u.rank}) - *${u.xp.toLocaleString()} XP*`
        );

        const embed = new EmbedBuilder()
            .setColor('#f97316') // Orange/Gold color
            .setTitle('🥇 Global Leaderboard 👑')
            .setDescription('Who is dominating the Auto Shop?')
            .addFields(fields);

        await interaction.reply({ embeds: [embed] });
    }
};


// ============================================================
// 🚀 6. MAIN BOT INITIALIZATION & EXECUTION
// ============================================================

// Attach Commands to the Client Collection
client.commands = new Collection();
client.commands.set('shop', shopCommand);
client.commands.set('rank', rankCommand);
client.commands.set('history', historyCommand);
client.commands.set('leaderboard', leaderboardCommand);

/** Handles the core command logic execution flow */
async function executeCommand(interaction, commandName, command) {
    try {
        // 1. Primary Trust Check: Must be verified!
        const user = await getUserData(interaction);
        if (!user.isVerified) {
            return interaction.reply({ 
                content: `🔒 **🔒 ACCESS RESTRICTED** 🔒🔒\n${interaction.user.username}, you must be verified to use this feature! \nUse /verify to unlock the shop!`,
                ephemeral: true 
            });
        }
        
        // 2. Execute the specific command logic
        await command.execute(interaction, user);
        
    } catch (error) {
        console.error(`[${commandName}] Error:`, error);
        // 3. Handle unexpected errors gracefully
        await interaction.reply({ 
            content: `🚨 **FATAL ERROR:** Something went wrong with the \`/${commandName}\` command!\n*Reason:* ${error.message}`,
            ephemeral: true
        });
    }
}


// --- DB Connection Handler ---
async function connectDB() {
    try {
        await mongoose.connect(config.DB_URI);
        console.log('=========================================');
        console.log('✅ MongoDB Connected Successfully! Database is LIVE.');
    } catch (error) {
        console.error('=========================================');
        console.error('❌ MongoDB Connection Error:', error);
        console.error('=========================================');
        process.exit(1); // Stop the bot if the DB connection fails
    }
}

// --- Utility Function: Get User Data ---
async function getUserData(interaction) {
    // Check if user exists, otherwise create a new one (Bootstrap Trust)
    let user = await User.findOne({ userId: interaction.user.id });
    if (!user) {
        user = new User({
            userId: interaction.user.id,
            username: interaction.user.tag,
        });
        await user.save();
    }
    return user;
}

// --- Discord Ready Event ---
client.on('ready', async () => {
    console.log(`\n🤖 Bot Logged in as: ${client.user.tag}`);
    console.log('=========================================');
    
    // Sync Slash Commands (Tells Discord what commands the bot has)
    try {
        await client.application.commands.set([]); // Clear old commands first
        await client.application.commands.set([
            new SlashCommandBuilder().setName('shop').setDescription('🛒 Browse the main shop & buy items.'),
            new SlashCommandBuilder().setName('rank').setDescription('⭐ Check your current rank and level.'),
            new SlashCommandBuilder().setName('history').setDescription('📜 View your transaction history.'),
            new SlashCommandBuilder().setName('leaderboard').setDescription('🥇 See the top users based on XP.'),
            new SlashCommandBuilder().setName('verify').setDescription('✅ Verify your account to unlock all features.')
        ]);
        console.log('✅ Slash Commands successfully synced!');
    } catch (e) {
        console.error('❌ Failed to sync commands:', e);
    }
});

// --- Slash Command Listener ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const commandName = interaction.commandName;
    const command = client.commands.get(commandName);

    if (!command) {
        return interaction.reply({ content: `**❓** Unknown command: \`/` + commandName + `\``, ephemeral: true });
    }

    // Special command handling (Verification)
    if (commandName === 'verify') {
        const user = await getUserData(interaction);
        if (user.isVerified) {
            return interaction.reply({ content: `✅ You are already verified!`, ephemeral: true });
        }
        // Mark user as verified
        user.isVerified = true;
        await user.save();
        return interaction.reply({ content: `🌟 **VERIFICATION COMPLETE!** Access all features now!`, ephemeral: true });
    }

    // Standard command execution
    await executeCommand(interaction, commandName, command);
});

// ============================================================
// 🚀 START BOT
// ============================================================
async function startBot() {
    await connectDB();
    client.login(config.TOKEN);
}

startBot();
